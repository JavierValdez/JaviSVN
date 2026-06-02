import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

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
  downloadFileName: string | null
  downloadedInstallerPath: string | null
  error: string | null
}

interface UpdateDownloadAsset {
  name: string
  url: string
  size: number | null
}

interface ReleaseMetadata {
  version: string
  releaseDate: string | null
  files: UpdateDownloadAsset[]
}

interface LatestReleaseInfo {
  version: string
  name: string
  releaseDate: string | null
  releaseNotes: string | null
  downloadAsset: UpdateDownloadAsset | null
}

let updaterInitialized = false
let checkInFlight: Promise<void> | null = null
let downloadInFlight: Promise<AppUpdateState> | null = null
let latestDownloadAsset: UpdateDownloadAsset | null = null

const RELEASES_BASE_URL = (
  process.env.JAVISVN_RELEASES_BASE_URL ||
  'https://storage.googleapis.com/artictools-releases/javisvn/releases'
).replace(/\/+$/, '')
const RELEASES_PAGE = RELEASES_BASE_URL

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
  downloadFileName: null,
  downloadedInstallerPath: null,
  error: null
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err || 'Error desconocido al verificar actualizaciones')
}

function getOpenWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
}

function emitState(targetWindow?: BrowserWindow): void {
  const payload = { ...updateState }

  if (targetWindow) {
    if (!targetWindow.isDestroyed()) targetWindow.webContents.send('appUpdate:state', payload)
    return
  }

  for (const window of getOpenWindows()) {
    window.webContents.send('appUpdate:state', payload)
  }
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
    progressPercent: null,
    downloadFileName: null,
    downloadedInstallerPath: null
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

function parseYamlValue(raw: string): string {
  const value = raw.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function resolveReleaseUrl(value: string): string {
  const assetPath = parseYamlValue(value)
  if (/^https?:\/\//i.test(assetPath)) return assetPath
  return `${RELEASES_BASE_URL}/${assetPath.replace(/^\/+/, '')}`
}

function getReleaseAssetName(value: string): string {
  const assetPath = parseYamlValue(value).split('?')[0]
  try {
    const parsed = new URL(assetPath)
    return path.basename(decodeURIComponent(parsed.pathname))
  } catch {
    return path.basename(assetPath)
  }
}

function parseReleaseMetadata(raw: string): ReleaseMetadata {
  const versionMatch = raw.match(/^version:\s*(.+)$/m)
  if (!versionMatch) {
    throw new Error('Metadata de actualización inválida: falta version.')
  }

  const releaseDateMatch = raw.match(/^releaseDate:\s*(.+)$/m)
  const files: UpdateDownloadAsset[] = []
  let currentFile: UpdateDownloadAsset | null = null

  for (const line of raw.split(/\r?\n/)) {
    const urlMatch = line.match(/^\s*(?:-\s*)?url:\s*(.+)$/)
    if (urlMatch) {
      const assetPath = parseYamlValue(urlMatch[1])
      currentFile = {
        name: getReleaseAssetName(assetPath),
        url: resolveReleaseUrl(assetPath),
        size: null
      }
      files.push(currentFile)
      continue
    }

    const sizeMatch = line.match(/^\s*size:\s*(\d+)\s*$/)
    if (sizeMatch && currentFile) {
      currentFile.size = Number(sizeMatch[1])
    }
  }

  const pathMatch = raw.match(/^path:\s*(.+)$/m)
  if (files.length === 0 && pathMatch) {
    const assetPath = parseYamlValue(pathMatch[1])
    files.push({
      name: getReleaseAssetName(assetPath),
      url: resolveReleaseUrl(assetPath),
      size: null
    })
  }

  return {
    version: parseYamlValue(versionMatch[1]),
    releaseDate: releaseDateMatch ? parseYamlValue(releaseDateMatch[1]) : null,
    files
  }
}

function getMetadataFileName(): string | null {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'win32') return 'latest.yml'
  return null
}

function pickDownloadAsset(release: ReleaseMetadata): UpdateDownloadAsset | null {
  const assets = release.files
  if (assets.length > 0) {
    const platformPriority = process.platform === 'darwin'
      ? ['.dmg', '.zip', '.pkg']
      : process.platform === 'win32'
        ? ['.exe', '.msi', '.zip']
        : ['.AppImage', '.deb', '.rpm', '.tar.gz', '.zip']

    for (const ext of platformPriority) {
      const found = assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()))
      if (found) return found
    }

    return assets[0] ?? null
  }

  return null
}

function getDownloadTargetPath(asset: UpdateDownloadAsset): string {
  return path.join(app.getPath('downloads'), path.basename(asset.name))
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function syncExistingDownload(version: string, asset: UpdateDownloadAsset): Promise<boolean> {
  const targetPath = getDownloadTargetPath(asset)

  if (!(await fileExists(targetPath))) return false

  if (typeof asset.size === 'number' && asset.size > 0) {
    const stats = await fs.stat(targetPath)
    if (stats.size !== asset.size) return false
  }

  patchState({
    stage: 'downloaded',
    mode: 'manual',
    latestVersion: version,
    downloadedVersion: version,
    progressPercent: 100,
    downloadUrl: asset.url,
    downloadFileName: path.basename(targetPath),
    downloadedInstallerPath: targetPath,
    error: null
  })
  return true
}

function createDownloadProgressStream(totalBytes: number): Transform {
  let receivedBytes = 0

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      const progressPercent = totalBytes > 0
        ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
        : null

      patchState({
        stage: 'downloading',
        progressPercent,
        error: null
      })

      callback(null, chunk)
    }
  })
}

async function revealDownloadedInstaller(): Promise<boolean> {
  const installerPath = updateState.downloadedInstallerPath
  if (!installerPath || !(await fileExists(installerPath))) {
    patchState({
      stage: latestDownloadAsset ? 'available' : 'idle',
      downloadedVersion: null,
      progressPercent: null,
      downloadedInstallerPath: null,
      error: 'No se encontró el instalador descargado. Puedes volver a descargarlo.'
    })
    return false
  }

  shell.showItemInFolder(installerPath)
  return true
}

async function fetchLatestRelease(): Promise<LatestReleaseInfo> {
  const metadataFileName = getMetadataFileName()
  if (!metadataFileName) {
    throw new Error('No hay actualizaciones configuradas para esta plataforma.')
  }

  const response = await fetch(`${RELEASES_BASE_URL}/${metadataFileName}`, {
    headers: {
      Accept: 'text/yaml,text/plain',
      'User-Agent': `JaviSVN/${app.getVersion()}`
    },
    redirect: 'follow'
  })

  if (!response.ok) {
    throw new Error(`El bucket de releases respondió con estado ${response.status}.`)
  }

  const metadata = parseReleaseMetadata(await response.text())
  const version = normalizeVersion(metadata.version)

  return {
    version,
    name: `JaviSVN ${version}`,
    releaseDate: metadata.releaseDate,
    releaseNotes: null,
    downloadAsset: pickDownloadAsset(metadata)
  }
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
    const latestVersion = normalizeVersion(latest.version)
    const currentVersion = app.getVersion()
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    const downloadAsset = latest.downloadAsset
    latestDownloadAsset = hasUpdate ? downloadAsset : null

    if (hasUpdate && !downloadAsset) {
      patchState({
        stage: 'error',
        mode: 'manual',
        latestVersion,
        downloadedVersion: null,
        progressPercent: null,
        releaseName: latest.name,
        releaseDate: latest.releaseDate,
        releaseNotes: latest.releaseNotes,
        downloadUrl: RELEASES_PAGE,
        downloadFileName: null,
        downloadedInstallerPath: null,
        error: 'No se encontró un instalador compatible en el metadata de actualización.'
      })
      return
    }

    if (hasUpdate && downloadAsset && await syncExistingDownload(latestVersion, downloadAsset)) {
      patchState({
        releaseName: latest.name,
        releaseDate: latest.releaseDate,
        releaseNotes: latest.releaseNotes
      })
      return
    }

    patchState({
      stage: hasUpdate ? 'available' : 'not-available',
      mode: 'manual',
      latestVersion,
      downloadedVersion: null,
      progressPercent: null,
      releaseName: latest.name,
      releaseDate: latest.releaseDate,
      releaseNotes: latest.releaseNotes,
      downloadUrl: hasUpdate ? downloadAsset?.url || null : null,
      downloadFileName: hasUpdate ? downloadAsset?.name || null : null,
      downloadedInstallerPath: null,
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

  if (downloadInFlight) return downloadInFlight

  if (updateState.stage === 'downloaded') {
    await revealDownloadedInstaller()
    return { ...updateState }
  }

  if (!latestDownloadAsset || updateState.stage === 'idle' || updateState.stage === 'error') {
    await checkForUpdates()
  }

  const stageAfterCheck = updateState.stage as UpdateStage

  if (stageAfterCheck === 'downloaded') {
    await revealDownloadedInstaller()
    return { ...updateState }
  }

  if (stageAfterCheck !== 'available' || !latestDownloadAsset) {
    throw new Error('No hay una actualización disponible para descargar')
  }

  const asset = latestDownloadAsset
  downloadInFlight = (async () => {
    const targetPath = getDownloadTargetPath(asset)
    const tempPath = `${targetPath}.download`

    patchState({
      stage: 'downloading',
      latestVersion: updateState.latestVersion,
      downloadedVersion: null,
      progressPercent: 0,
      downloadUrl: asset.url,
      downloadFileName: path.basename(targetPath),
      downloadedInstallerPath: null,
      error: null
    })

    try {
      const response = await fetch(asset.url, {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': `JaviSVN/${app.getVersion()}`
        },
        redirect: 'follow'
      })

      if (!response.ok || !response.body) {
        throw new Error(`La descarga falló con estado ${response.status}.`)
      }

      const contentLength = Number(response.headers.get('content-length') ?? asset.size ?? 0)
      const totalBytes = Number.isFinite(contentLength) ? contentLength : 0

      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
        createDownloadProgressStream(totalBytes),
        createWriteStream(tempPath)
      )

      await fs.rm(targetPath, { force: true })
      await fs.rename(tempPath, targetPath)

      patchState({
        stage: 'downloaded',
        downloadedVersion: updateState.latestVersion,
        progressPercent: 100,
        downloadFileName: path.basename(targetPath),
        downloadedInstallerPath: targetPath,
        error: null
      })
    } catch (err) {
      await fs.rm(tempPath, { force: true })
      patchState({
        stage: 'error',
        progressPercent: null,
        downloadedVersion: null,
        downloadedInstallerPath: null,
        error: formatError(err)
      })
    } finally {
      downloadInFlight = null
    }

    return { ...updateState }
  })()

  return downloadInFlight
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
  if (updaterInitialized) {
    emitState(window)
    return
  }
  updaterInitialized = true
  registerIpc()

  if (!app.isPackaged) {
    markUnsupported('Actualizaciones automáticas disponibles solo en la app empaquetada.')
    return
  }

  if (!getMetadataFileName()) {
    markUnsupported('Actualizaciones disponibles solo para macOS y Windows.')
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
