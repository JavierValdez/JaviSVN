import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { get } from 'https'

type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

type UpdateMode = 'manual' | 'unsupported'

export interface AppUpdateState {
  stage: UpdateStage
  currentVersion: string
  autoUpdatesEnabled: boolean
  mode: UpdateMode
  latestVersion: string | null
  downloadedVersion: string | null
  progressPercent: number | null
  lastCheckedAt: string | null
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string | null
  downloadUrl: string | null
  error: string | null
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  name?: string
  body?: string
  published_at?: string
  html_url?: string
  assets?: GithubReleaseAsset[]
}

let windowRef: BrowserWindow | null = null
let updaterInitialized = false
let checkInFlight: Promise<void> | null = null

const UPDATE_OWNER = process.env.JAVISVN_UPDATE_OWNER || 'JavierValdez'
const UPDATE_REPO = process.env.JAVISVN_UPDATE_REPO || 'JaviSVN'
const UPDATE_TOKEN = (process.env.JAVISVN_UPDATE_TOKEN || '').trim()
const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`

const updateState: AppUpdateState = {
  stage: 'idle',
  currentVersion: app.getVersion(),
  autoUpdatesEnabled: false,
  mode: 'unsupported',
  latestVersion: null,
  downloadedVersion: null,
  progressPercent: null,
  lastCheckedAt: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: null,
  downloadUrl: null,
  error: null
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err || 'Error desconocido al verificar actualizaciones')
}

function emitState(): void {
  if (!windowRef || windowRef.isDestroyed()) return
  windowRef.webContents.send('appUpdate:state', { ...updateState })
}

function patchState(patch: Partial<AppUpdateState>): void {
  Object.assign(updateState, patch, { currentVersion: app.getVersion() })
  emitState()
}

function markUnsupported(reason: string): void {
  patchState({
    stage: 'unsupported',
    autoUpdatesEnabled: false,
    mode: 'unsupported',
    error: reason,
    progressPercent: null
  })
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function parseVersion(raw: string): { parts: number[]; preRelease: boolean } {
  const normalized = normalizeVersion(raw)
  const [stablePart, pre] = normalized.split('-', 2)
  const parts = stablePart
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
  return { parts, preRelease: Boolean(pre) }
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a)
  const bv = parseVersion(b)
  const max = Math.max(av.parts.length, bv.parts.length)

  for (let i = 0; i < max; i += 1) {
    const ai = av.parts[i] ?? 0
    const bi = bv.parts[i] ?? 0
    if (ai > bi) return 1
    if (ai < bi) return -1
  }

  if (av.preRelease && !bv.preRelease) return -1
  if (!av.preRelease && bv.preRelease) return 1
  return 0
}

function pickDownloadUrl(release: GithubRelease): string | null {
  const assets = Array.isArray(release.assets) ? release.assets : []
  if (assets.length > 0) {
    const platformPriority = process.platform === 'darwin'
      ? ['.dmg', '.zip', '.pkg']
      : process.platform === 'win32'
        ? ['.exe', '.msi', '.zip']
        : ['.AppImage', '.deb', '.rpm', '.tar.gz', '.zip']

    for (const ext of platformPriority) {
      const found = assets.find((a) => a?.name?.toLowerCase().endsWith(ext.toLowerCase()))
      if (found?.browser_download_url) return found.browser_download_url
    }
    if (assets[0]?.browser_download_url) return assets[0].browser_download_url
  }

  return release.html_url || RELEASES_PAGE
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'JaviSVN-Updater'
    }
    if (UPDATE_TOKEN) {
      headers.Authorization = `Bearer ${UPDATE_TOKEN}`
    }

    const req = get(
      LATEST_RELEASE_API,
      {
        headers
      },
      (res) => {
        const chunks: Buffer[] = []

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('error', (err) => reject(err))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const code = res.statusCode || 0

          if (code < 200 || code >= 300) {
            let apiMessage = ''
            try {
              const parsed = JSON.parse(raw) as { message?: unknown }
              if (typeof parsed.message === 'string') apiMessage = parsed.message
            } catch {
              // Ignore invalid JSON body.
            }
            if (code === 404) {
              reject(new Error(
                'GitHub respondió 404. El repo/release no es visible públicamente o no hay release publicada.'
              ))
              return
            }
            reject(new Error(apiMessage || `GitHub respondió con estado ${code}`))
            return
          }

          try {
            const parsed = JSON.parse(raw) as GithubRelease
            if (!parsed?.tag_name) {
              reject(new Error('Respuesta de release inválida'))
              return
            }
            resolve(parsed)
          } catch {
            reject(new Error('No se pudo parsear la respuesta de GitHub Releases'))
          }
        })
      }
    )

    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function checkForUpdates(): Promise<AppUpdateState> {
  if (!updateState.autoUpdatesEnabled) return { ...updateState }
  if (checkInFlight) {
    await checkInFlight
    return { ...updateState }
  }

  patchState({
    stage: 'checking',
    lastCheckedAt: new Date().toISOString(),
    progressPercent: null,
    error: null
  })

  checkInFlight = (async () => {
    const latest = await fetchLatestRelease()
    const latestVersion = normalizeVersion(latest.tag_name)
    const currentVersion = app.getVersion()
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    const downloadUrl = pickDownloadUrl(latest)

    patchState({
      stage: hasUpdate ? 'available' : 'not-available',
      mode: 'manual',
      latestVersion,
      downloadedVersion: null,
      progressPercent: null,
      releaseName: latest.name || null,
      releaseDate: latest.published_at || null,
      releaseNotes: latest.body || null,
      downloadUrl,
      error: null
    })
  })()

  try {
    await checkInFlight
  } catch (err) {
    patchState({
      stage: 'error',
      error: formatError(err),
      progressPercent: null
    })
  } finally {
    checkInFlight = null
  }

  return { ...updateState }
}

async function downloadUpdate(): Promise<AppUpdateState> {
  if (!updateState.autoUpdatesEnabled) return { ...updateState }
  if (updateState.stage !== 'available') {
    throw new Error('No hay una actualización disponible para descargar')
  }

  const url = updateState.downloadUrl || RELEASES_PAGE
  await shell.openExternal(url)

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Instalar actualización',
    message: `JaviSVN ${updateState.latestVersion} está descargándose`,
    detail:
      'Cuando la descarga termine, cierra JaviSVN antes de abrir el instalador.\n\n' +
      '¿Deseas salir ahora para instalar la actualización cuando se complete la descarga?',
    buttons: ['Salir ahora', 'Instalar después'],
    defaultId: 0,
    cancelId: 1
  })

  if (response === 0) {
    app.quit()
  }

  return { ...updateState }
}

function registerIpc(): void {
  ipcMain.handle('appUpdate:getState', () => ({ ...updateState }))
  ipcMain.handle('appUpdate:check', async () => checkForUpdates())
  ipcMain.handle('appUpdate:download', async () => downloadUpdate())
  ipcMain.handle('appUpdate:quitAndInstall', () => {
    throw new Error('Instalación automática no disponible sin firma. Descarga e instala manualmente.')
  })
}

export function setupAppUpdater(window: BrowserWindow): void {
  windowRef = window

  if (updaterInitialized) {
    emitState()
    return
  }
  updaterInitialized = true
  registerIpc()

  if (!app.isPackaged) {
    markUnsupported('Actualizaciones automáticas disponibles solo en la app empaquetada.')
    return
  }

  updateState.autoUpdatesEnabled = true
  updateState.mode = 'manual'
  emitState()

  setTimeout(() => {
    void checkForUpdates()
  }, 6000)

  const everySixHoursMs = 6 * 60 * 60 * 1000
  setInterval(() => {
    void checkForUpdates()
  }, everySixHoursMs)
}
