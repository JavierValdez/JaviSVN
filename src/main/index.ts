import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { setupAppUpdater } from './updater'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { createRequire } from 'module'
import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { pathToFileURL } from 'node:url'

const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xml2js = _require('xml2js') as any
const parseStringPromise = xml2js.parseStringPromise

const isDev = process.env.NODE_ENV === 'development'

// Set app name before ready so it shows correctly in the dock and menu bar
app.name = 'JaviSVN'
const DEFAULT_SERVER_URL = ''
function getDefaultSvnCandidates(): string[] {
  if (process.platform === 'win32') {
    const pf   = process.env.ProgramFiles        || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      join(pf,   'TortoiseSVN', 'bin', 'svn.exe'),
      join(pf86, 'TortoiseSVN', 'bin', 'svn.exe'),
      join(pf,   'SlikSvn', 'bin', 'svn.exe'),
      join(pf,   'CollabNet Subversion Client', 'svn.exe'),
      'svn.exe',
    ]
  }
  return [
    '/opt/homebrew/bin/svn',
    '/usr/local/bin/svn',
    '/usr/bin/svn',
    '/opt/local/bin/svn',
  ]
}

function getExtraPathSegments(): string {
  if (process.platform === 'win32') {
    const pf   = process.env.ProgramFiles        || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [join(pf, 'TortoiseSVN', 'bin'), join(pf86, 'TortoiseSVN', 'bin')].join(';')
  }
  return '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
}

// ─── Simple JSON Store ────────────────────────────────────────────────────────
function getStorePath(): string {
  const userData = app.getPath('userData')
  return join(userData, 'javisvn-config.json')
}

function readStore(): Record<string, any> {
  try {
    const data = readFileSync(getStorePath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

function writeStore(data: Record<string, any>): void {
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8')
}

function storeGet(key: string): any {
  return readStore()[key]
}

function storeSet(key: string, value: any): void {
  const data = readStore()
  data[key] = value
  writeStore(data)
}

function storeDelete(key: string): void {
  const data = readStore()
  delete data[key]
  writeStore(data)
}

interface StoredRemote {
  id: string
  name: string
  url: string
  createdAt: string
}

interface StoredRemotesState {
  exists: boolean
  remotes: StoredRemote[]
}

function encryptPassword(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) return password
  return safeStorage.encryptString(password).toString('base64')
}

function decryptPassword(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return value // fallback: ya es texto plano (caso de migración)
  }
}

function writeStoredCredentials(creds: { username: string; password: string; serverUrl: string }): void {
  const passwordEncrypted = encryptPassword(creds.password)
  storeSet('credentials', { username: creds.username, passwordEncrypted, serverUrl: creds.serverUrl })
}

function getStoredCredentials(): { username: string; password: string; serverUrl: string } | null {
  const stored = storeGet('credentials')
  if (!stored || typeof stored !== 'object') return null

  let password: string
  if (stored.passwordEncrypted) {
    password = decryptPassword(stored.passwordEncrypted)
  } else if (stored.password) {
    // Migración automática: texto plano → cifrado
    password = stored.password
    writeStoredCredentials({ username: stored.username || '', password, serverUrl: stored.serverUrl || '' })
  } else {
    return null
  }
  return { username: stored.username || '', password, serverUrl: stored.serverUrl || '' }
}

function getCurrentServerUrl(): string {
  const creds = getStoredCredentials()
  return creds?.serverUrl || storeGet('serverUrl') || DEFAULT_SERVER_URL
}

function setCurrentServerUrl(url: string): void {
  const nextUrl = (url || '').trim()
  if (!nextUrl) return

  const creds = getStoredCredentials()
  if (creds && (creds.username || creds.password)) {
    storeSet('credentials', { ...creds, serverUrl: nextUrl })
  }
  storeSet('serverUrl', nextUrl)
}

function clearCurrentServerUrl(): void {
  const creds = getStoredCredentials()
  if (creds) {
    storeSet('credentials', { ...creds, serverUrl: '' })
  }
  storeSet('serverUrl', '')
}

function getStoredRemotesState(): StoredRemotesState {
  const raw = storeGet('remoteServers')
  if (!Array.isArray(raw)) return { exists: false, remotes: [] }

  return {
    exists: true,
    remotes: raw
    .filter((x: any) => x && typeof x === 'object' && x.id && x.name && x.url)
    .map((x: any) => ({
      id: String(x.id),
      name: String(x.name),
      url: String(x.url),
      createdAt: String(x.createdAt || new Date().toISOString())
    }))
  }
}

function saveStoredRemotes(remotes: StoredRemote[]): void {
  storeSet('remoteServers', remotes)
}

function ensureRemotesSeeded(): StoredRemote[] {
  const { exists, remotes } = getStoredRemotesState()
  if (exists) return remotes

  const currentUrl = getCurrentServerUrl().trim()
  if (!currentUrl) {
    saveStoredRemotes([])
    return []
  }

  const seeded: StoredRemote[] = [{
    id: `remote-${Date.now()}`,
    name: 'Servidor principal',
    url: currentUrl,
    createdAt: new Date().toISOString()
  }]
  saveStoredRemotes(seeded)
  return seeded
}

// ─── Store & Paths ────────────────────────────────────────────────────────────
const BASE_REPO_PATH = join(homedir(), 'Documents', 'JaviSvn')

if (!existsSync(BASE_REPO_PATH)) {
  mkdirSync(BASE_REPO_PATH, { recursive: true })
}

function normalizeRepoUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readUtf8IfExists(path: string): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function resolveRepoRelativeTarget(repoPath: string, filePath: string): {
  repoAbs: string
  targetAbs: string
  relativePath: string
} {
  const repoAbs = resolve(repoPath)
  const targetAbs = resolve(repoPath, filePath)
  const relativePath = relative(repoAbs, targetAbs)

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Ruta fuera del repositorio')
  }

  return { repoAbs, targetAbs, relativePath }
}

function sanitizePreviewFileName(value: string, fallback = 'preview.bin'): string {
  const baseName = basename(String(value || '').trim()) || fallback
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return sanitized || fallback
}

function buildPreviewFileResponse(filePath: string, name?: string): { path: string; name: string; fileUrl: string } {
  const safeName = sanitizePreviewFileName(name || basename(filePath))
  return {
    path: filePath,
    name: safeName,
    fileUrl: pathToFileURL(filePath).toString()
  }
}

async function exportRemotePreviewFile(url: string, suggestedName?: string): Promise<{ path: string; name: string; fileUrl: string }> {
  const safeUrl = String(url || '').trim()
  if (!safeUrl) throw new Error('La URL del archivo es requerida')

  const fallbackName = basename(safeUrl.replace(/\/+$/g, '')) || 'preview.bin'
  const safeName = sanitizePreviewFileName(suggestedName || fallbackName)
  const previewDir = mkdtempSync(join(tmpdir(), 'javisvn-preview-'))
  const targetPath = join(previewDir, safeName)

  await runSvn(['export', '--force', safeUrl, targetPath], {
    timeoutMs: 5 * 60 * 1000
  })

  return buildPreviewFileResponse(targetPath, safeName)
}

function sanitizeLocalRepoName(targetName: string): string {
  const safeName = String(targetName || '').trim()
  if (!safeName) throw new Error('El nombre del directorio local es requerido')
  if (safeName === '.' || safeName === '..') {
    throw new Error('Nombre de directorio inválido')
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(safeName)) {
    throw new Error('El nombre del directorio local contiene caracteres no permitidos')
  }
  return safeName
}

let localRepoUrlIndexCache: { expiresAt: number; map: Map<string, string> } | null = null

function invalidateLocalRepoUrlIndexCache(): void {
  localRepoUrlIndexCache = null
}

async function getLocalRepoUrlIndex(): Promise<Map<string, string>> {
  if (localRepoUrlIndexCache && localRepoUrlIndexCache.expiresAt > Date.now()) {
    return new Map(localRepoUrlIndexCache.map)
  }

  const index = new Map<string, string>()
  if (!existsSync(BASE_REPO_PATH)) return index

  const entries = readdirSync(BASE_REPO_PATH)
  for (const entry of entries) {
    const fullPath = join(BASE_REPO_PATH, entry)
    try {
      const stat = statSync(fullPath)
      if (!stat.isDirectory()) continue
      if (!existsSync(join(fullPath, '.svn'))) continue

      const { stdout } = await runSvn(['info', '--xml', fullPath])
      const parsed = await parseXml(stdout)
      const repoUrl = normalizeRepoUrl(parsed.info?.entry?.url || '')
      if (repoUrl) index.set(repoUrl, fullPath)
    } catch {
      // ignore invalid working copies
    }
  }

  localRepoUrlIndexCache = {
    expiresAt: Date.now() + 5000,
    map: index
  }

  return new Map(index)
}

// ─── Find svn binary ─────────────────────────────────────────────────────────
function buildEnvWithExtraPath(): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':'
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const extra = getExtraPathSegments()
  const current = process.env[pathKey] || process.env.PATH || ''
  const firstSegment = extra.split(sep)[0] || ''
  const merged = (firstSegment && current.includes(firstSegment)) ? current : `${extra}${sep}${current}`
  return { ...process.env, [pathKey]: merged, PATH: merged }
}

function canExecuteSvn(bin: string): boolean {
  try {
    const result = spawnSync(bin, ['--version', '--quiet'], {
      env: { ...buildEnvWithExtraPath(), LANG: 'en_US.UTF-8' },
      encoding: 'utf-8',
      timeout: 4000
    })
    if (result.error) return false
    return result.status === 0 && Boolean((result.stdout || '').trim())
  } catch {
    return false
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((v) => Boolean(v && v.trim())))]
}

function findSvnBin(preferred?: string): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const fallback = `svn${ext}`
  // 1. Bundled binary (packaged app: Contents/Resources/bin/svn[.exe])
  const bundledPackaged = join(process.resourcesPath || '', 'bin', `svn${ext}`)
  // 2. Bundled binary (dev mode: project/resources/bin/svn[.exe])
  const bundledDev = join(__dirname, `../../resources/bin/svn${ext}`)

  const preferredValues = [preferred || '', process.env.JAVISVN_SVN_BIN || '']

  // For distributed app, prefer embedded SVN to avoid external dependencies.
  // For dev, prefer system SVN first to avoid local packaged-binary issues.
  const candidates = app.isPackaged
    ? uniqueStrings([
      ...preferredValues,
      bundledPackaged,
      bundledDev,
      ...getDefaultSvnCandidates(),
      fallback
    ])
    : uniqueStrings([
      ...preferredValues,
      ...getDefaultSvnCandidates(),
      bundledPackaged,
      bundledDev,
      fallback
    ])

  for (const c of candidates) {
    if (c !== fallback && !existsSync(c)) continue
    if (canExecuteSvn(c)) return c
  }
  return fallback
}
let SVN_BIN = findSvnBin((storeGet('svnBinPath') || '').toString())

type SupportedEditorId = 'vscode' | 'vscode-insiders'

interface DetectedEditor {
  id: SupportedEditorId
  label: string
  command?: string
  macAppPath?: string
  winExecutablePath?: string
}

function commandExists(command: string): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(locator, [command], {
    env: buildEnvWithExtraPath(),
    stdio: 'ignore',
    windowsHide: true,
    timeout: 3000
  })
  return !result.error && result.status === 0
}

function firstExistingPath(paths: string[]): string | undefined {
  for (const path of paths) {
    if (path && existsSync(path)) return path
  }
  return undefined
}

function detectEditors(): DetectedEditor[] {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const definitions: Array<{
    id: SupportedEditorId
    label: string
    command: string
    macAppName: string
    winCandidates: string[]
  }> = [
    {
      id: 'vscode',
      label: 'VS Code',
      command: 'code',
      macAppName: 'Visual Studio Code.app',
      winCandidates: [
        join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        join(programFiles, 'Microsoft VS Code', 'Code.exe'),
        join(programFilesX86, 'Microsoft VS Code', 'Code.exe')
      ]
    },
    {
      id: 'vscode-insiders',
      label: 'VS Code Insiders',
      command: 'code-insiders',
      macAppName: 'Visual Studio Code - Insiders.app',
      winCandidates: [
        join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
        join(programFiles, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
        join(programFilesX86, 'Microsoft VS Code Insiders', 'Code - Insiders.exe')
      ]
    }
  ]

  return definitions
    .map((editor) => {
      const command = commandExists(editor.command) ? editor.command : undefined
      const macAppPath = process.platform === 'darwin'
        ? firstExistingPath([
          join('/Applications', editor.macAppName),
          join(homedir(), 'Applications', editor.macAppName)
        ])
        : undefined
      const winExecutablePath = process.platform === 'win32'
        ? firstExistingPath(editor.winCandidates)
        : undefined

      if (!command && !macAppPath && !winExecutablePath) return null
      return {
        id: editor.id,
        label: editor.label,
        command,
        macAppPath,
        winExecutablePath
      } as DetectedEditor
    })
    .filter((x): x is DetectedEditor => x !== null)
}

function buildEditorLaunchEnv(): NodeJS.ProcessEnv {
  const env = { ...buildEnvWithExtraPath() }

  // Avoid leaking Electron/VS Code process state into a fresh VS Code launch.
  for (const key of Object.keys(env)) {
    if (key === 'ELECTRON_ENABLE_LOGGING' || key === 'ELECTRON_ENABLE_STACK_DUMPING') continue
    if (key.startsWith('VSCODE_') || key.startsWith('ELECTRON_')) {
      delete env[key]
    }
  }

  return env
}

function runCommand(command: string, args: string[], options: { shell?: boolean } = {}): boolean {
  try {
    const proc = spawn(command, args, {
      env: buildEditorLaunchEnv(),
      stdio: 'ignore',
      windowsHide: true,
      shell: options.shell || false,
      detached: true
    })

    proc.unref()
    return Boolean(proc.pid)
  } catch {
    return false
  }
}

function openRepoInEditor(editorId: SupportedEditorId, repoPath: string): void {
  const safePath = (repoPath || '').trim()
  if (!safePath) throw new Error('Ruta de repositorio inválida')
  if (!existsSync(safePath)) throw new Error('El repositorio no existe')
  if (!statSync(safePath).isDirectory()) throw new Error('La ruta no es una carpeta')

  const editor = detectEditors().find((x) => x.id === editorId)
  if (!editor) throw new Error('Ese editor no está disponible en este equipo')

  // On Windows, prefer launching the detected .exe directly to avoid shell arg splitting
  // when repository paths contain spaces.
  if (process.platform === 'win32') {
    if (editor.winExecutablePath && runCommand(editor.winExecutablePath, [safePath])) return
    if (editor.command && runCommand(editor.command, [safePath], { shell: true })) return
  } else {
    if (editor.command && runCommand(editor.command, [safePath])) return
    if (process.platform === 'darwin' && editor.macAppPath && runCommand('open', ['-a', editor.macAppPath, safePath])) return
  }

  throw new Error(`No se pudo abrir el repositorio en ${editor.label}`)
}

// ─── Main Window ─────────────────────────────────────────────────────────────
function sendToWindow(window: BrowserWindow | null, channel: string, payload: string): void {
  if (!window || window.isDestroyed()) return
  window.webContents.send(channel, payload)
}

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function createWindow(sourceWindow?: BrowserWindow | null): BrowserWindow {
  const preloadCandidates = [
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js')
  ]
  const preloadPath = preloadCandidates.find((p) => existsSync(p)) || preloadCandidates[0]

  const windowsIconCandidates = [
    join(app.getAppPath(), 'resources', 'icon.ico'),
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../resources/icon.ico')
  ]
  const windowsIconPath = process.platform === 'win32'
    ? windowsIconCandidates.find((p) => existsSync(p))
    : undefined

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    ...(windowsIconPath ? { icon: windowsIconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  const shouldMaximize = Boolean(sourceWindow && !sourceWindow.isDestroyed() && sourceWindow.isMaximized())
  if (sourceWindow && !sourceWindow.isDestroyed() && !shouldMaximize) {
    const [x, y] = sourceWindow.getPosition()
    const [width, height] = sourceWindow.getSize()
    window.setBounds({
      x: x + 28,
      y: y + 28,
      width,
      height
    })
  }

  window.on('ready-to-show', () => {
    if (shouldMaximize) window.maximize()
    window.show()
    setupAppUpdater(window)
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function openNewWindow(sourceWindow?: BrowserWindow | null): BrowserWindow {
  const referenceWindow = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow
    : BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  return createWindow(referenceWindow)
}

function buildDockMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Nueva ventana',
      click: () => {
        openNewWindow()
      }
    }
  ])
}

function setupDockMenu(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  app.dock.setMenu(buildDockMenu())
}

function setupApplicationMenu(): void {
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Nueva ventana',
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        openNewWindow()
      }
    },
    { type: 'separator' },
    process.platform === 'darwin'
      ? { role: 'close', label: 'Cerrar ventana' }
      : { role: 'quit', label: 'Salir' }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'Archivo',
      submenu: fileSubmenu
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.javisvn.app')

  // Set dock icon in dev mode (in production the .icns in the bundle is used automatically)
  if (isDev && process.platform === 'darwin' && app.dock) {
    const iconPath = join(app.getAppPath(), 'ico.png')
    if (existsSync(iconPath)) app.dock.setIcon(iconPath)
  }

  setupApplicationMenu()
  setupDockMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:newWindow', async (event) => {
  openNewWindow(getEventWindow(event))
  return true
})

// ─── SVN Helper ──────────────────────────────────────────────────────────────
interface RunSvnOptions {
  cwd?: string
  onData?: (chunk: string) => void
  onErrorData?: (chunk: string) => void
  skipAuth?: boolean
  timeoutMs?: number
  allowLegacySslFallback?: boolean
  forceLegacySsl?: boolean
}

function getSvnAuthArgs(): string[] {
  const creds = getStoredCredentials()
  const args = [
    '--non-interactive',
    '--trust-server-cert',
    '--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other'
  ]
  if (creds?.username) {
    args.push('--username', creds.username, '--password', creds.password)
  }
  return args
}

const LEGACY_OPENSSL_CONF_NAME = 'javisvn-openssl-legacy.cnf'
const LEGACY_OPENSSL_CONF = `openssl_conf = default_conf

[default_conf]
ssl_conf = ssl_sect

[ssl_sect]
system_default = tls_defaults

[tls_defaults]
MinProtocol = TLSv1
CipherString = DEFAULT@SECLEVEL=0
Options = UnsafeLegacyRenegotiation
`

function isLegacySslError(message: string): boolean {
  return /E120171|SSL communication|tlsv1 alert|handshake/i.test(message)
}

function getLegacyOpenSslConfPath(): string | null {
  try {
    const confPath = join(app.getPath('userData'), LEGACY_OPENSSL_CONF_NAME)
    if (!existsSync(confPath) || readFileSync(confPath, 'utf-8') !== LEGACY_OPENSSL_CONF) {
      writeFileSync(confPath, LEGACY_OPENSSL_CONF, 'utf-8')
    }
    return confPath
  } catch {
    return null
  }
}

function runSvnOnce(
  args: string[],
  options: RunSvnOptions,
  useLegacySsl: boolean
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const allArgs = options.skipAuth ? [...args] : [...args, ...getSvnAuthArgs()]
    const env = { ...buildEnvWithExtraPath(), LANG: 'en_US.UTF-8' } as NodeJS.ProcessEnv
    if (useLegacySsl) {
      const confPath = getLegacyOpenSslConfPath()
      if (confPath) env.OPENSSL_CONF = confPath
    }

    const proc = spawn(SVN_BIN, allArgs, {
      cwd: options.cwd,
      env
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timeoutId: NodeJS.Timeout | undefined

    const finishResolve = (value: { stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      resolve(value)
    }

    const finishReject = (err: Error) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      reject(err)
    }

    const timeoutMs = options.timeoutMs ?? 0
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const cmd = args[0] || 'svn'
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!settled) proc.kill('SIGKILL')
        }, 1500)
        finishReject(new Error(`Tiempo de espera agotado (${Math.ceil(timeoutMs / 1000)}s) al ejecutar SVN (${cmd})`))
      }, timeoutMs)
    }

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      options.onData?.(s)
    })
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      options.onErrorData?.(s)
    })
    proc.on('close', (code) => {
      if (code === 0) finishResolve({ stdout, stderr })
      else finishReject(new Error(stderr || `SVN exited with code ${code}`))
    })
    proc.on('error', (err) => finishReject(err as Error))
  })
}

async function runSvn(
  args: string[],
  options: RunSvnOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  // Try legacy SSL first on every platform. This environment relies on
  // TLS 1.0 + expired cert compatibility for target SVN servers.
  const firstTryLegacy = options.forceLegacySsl !== false
  const shouldFallback = options.allowLegacySslFallback !== false

  try {
    return await runSvnOnce(args, options, firstTryLegacy)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (firstTryLegacy || !shouldFallback || !isLegacySslError(message)) {
      throw err
    }
    return runSvnOnce(args, options, true)
  }
}

async function parseXml(xml: string): Promise<any> {
  return parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: false
  })
}

function parseLogEntries(parsed: any): any[] {
  const entries = parsed.log?.logentry
  if (!entries) return []

  const arr = Array.isArray(entries) ? entries : [entries]
  return arr.map((e: any) => {
    let paths: any[] = []
    if (e.paths?.path) {
      paths = Array.isArray(e.paths.path) ? e.paths.path : [e.paths.path]
    }
    return {
      revision: parseInt(e.$?.revision || '0'),
      author: e.author || '',
      date: e.date || '',
      message: e.msg || '',
      paths: paths.map((p: any) => ({
        path: typeof p === 'string' ? p : p._ || '',
        action: p.$?.action || 'M'
      }))
    }
  })
}

function buildRemoteUrl(parentUrl: string, name: string): string {
  const safeName = (name || '').trim()
  if (!safeName) throw new Error('El nombre es requerido')
  if (safeName.includes('/') || safeName.includes('\\')) {
    throw new Error('El nombre no debe incluir "/" ni "\\"')
  }
  return `${parentUrl.replace(/\/$/, '')}/${encodeURIComponent(safeName)}`
}

// ─── IPC: Credentials ─────────────────────────────────────────────────────────
ipcMain.handle('creds:get', () => {
  return getStoredCredentials() || null
})

ipcMain.handle('creds:set', (_e, creds: { username: string; password: string; serverUrl: string }) => {
  writeStoredCredentials(creds)
  if (creds.serverUrl?.trim()) setCurrentServerUrl(creds.serverUrl.trim())
  return true
})

ipcMain.handle('creds:clear', () => {
  storeDelete('credentials')
  return true
})

ipcMain.handle('creds:getServerUrl', () => {
  return getCurrentServerUrl()
})

ipcMain.handle('creds:setServerUrl', (_e, serverUrl: string) => {
  const nextUrl = (serverUrl || '').trim()
  if (!nextUrl) throw new Error('La URL del servidor es requerida')
  setCurrentServerUrl(nextUrl)
  return true
})

// ─── IPC: Remote server tree ─────────────────────────────────────────────────
ipcMain.handle('remotes:list', () => {
  const remotes = ensureRemotesSeeded()
  const activeUrl = getCurrentServerUrl()
  return remotes.map((r) => ({
    ...r,
    active: r.url === activeUrl
  }))
})

ipcMain.handle('remotes:save', (_e, payload: { name: string; url: string }) => {
  const name = (payload?.name || '').trim()
  const url = (payload?.url || '').trim()
  if (!name) throw new Error('El nombre del repositorio remoto es requerido')
  if (!url) throw new Error('La URL del repositorio remoto es requerida')

  const remotes = ensureRemotesSeeded()
  const normalized = url.replace(/\/$/, '')
  const byUrl = remotes.find((r) => r.url.replace(/\/$/, '') === normalized)

  let saved: StoredRemote
  if (byUrl) {
    saved = { ...byUrl, name, url }
  } else {
    saved = {
      id: `remote-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      url,
      createdAt: new Date().toISOString()
    }
  }

  const next = byUrl
    ? remotes.map((r) => (r.id === byUrl.id ? saved : r))
    : [...remotes, saved]
  saveStoredRemotes(next)
  setCurrentServerUrl(saved.url)

  return { ...saved, active: true }
})

ipcMain.handle('remotes:select', (_e, remoteId: string) => {
  const id = (remoteId || '').trim()
  if (!id) throw new Error('Remote inválido')

  const remotes = ensureRemotesSeeded()
  const selected = remotes.find((r) => r.id === id)
  if (!selected) throw new Error('Repositorio remoto no encontrado')

  setCurrentServerUrl(selected.url)
  return { ...selected, active: true }
})

ipcMain.handle('remotes:delete', (_e, remoteId: string) => {
  const id = (remoteId || '').trim()
  if (!id) throw new Error('Remote inválido')

  const remotes = ensureRemotesSeeded()
  const deleted = remotes.find((r) => r.id === id)
  const next = remotes.filter((r) => r.id !== id)
  saveStoredRemotes(next)

  if (deleted?.url === getCurrentServerUrl()) {
    if (next.length > 0) setCurrentServerUrl(next[0].url)
    else clearCurrentServerUrl()
  }

  return true
})

ipcMain.handle('remotes:rename', (_e, remoteId: string, name: string, url?: string) => {
  const id = (remoteId || '').trim()
  const newName = (name || '').trim()
  if (!id) throw new Error('Remote inválido')
  if (!newName) throw new Error('El nombre es requerido')

  const remotes = ensureRemotesSeeded()
  const remote = remotes.find((r) => r.id === id)
  if (!remote) throw new Error('Repositorio remoto no encontrado')

  const newUrl = (url || '').trim() || remote.url
  const next = remotes.map((r) => (r.id === id ? { ...r, name: newName, url: newUrl } : r))
  saveStoredRemotes(next)
  if (remote.url === getCurrentServerUrl()) setCurrentServerUrl(newUrl)
  return { ...remote, name: newName, url: newUrl }
})

// ─── IPC: SVN binary override (legacy compatibility) ────────────────────────
ipcMain.handle('svn:getBinPath', async () => {
  let version: string | null = null
  try {
    const { stdout } = await runSvn(['--version', '--quiet'], { skipAuth: true, timeoutMs: 5000 })
    version = stdout.trim() || null
  } catch {}

  const configured = (storeGet('svnBinPath') || '').toString().trim() || null
  return { bin: SVN_BIN, configured, version }
})

ipcMain.handle('svn:setBinPath', async (_e, binPath: string) => {
  const next = (binPath || '').trim()

  if (!next || next.toLowerCase() === 'auto') {
    storeDelete('svnBinPath')
    SVN_BIN = findSvnBin()
  } else {
    if (next !== 'svn' && !existsSync(next)) {
      throw new Error(`No existe el binario SVN en la ruta: ${next}`)
    }
    if (!canExecuteSvn(next)) {
      throw new Error(`No se pudo ejecutar ese binario SVN: ${next}`)
    }
    storeSet('svnBinPath', next)
    SVN_BIN = next
  }

  let version: string | null = null
  try {
    const { stdout } = await runSvn(['--version', '--quiet'], { skipAuth: true, timeoutMs: 5000 })
    version = stdout.trim() || null
  } catch {}

  return { bin: SVN_BIN, version }
})

// ─── IPC: Local Repos ─────────────────────────────────────────────────────────
ipcMain.handle('repos:list', async () => {
  const results: any[] = []
  if (!existsSync(BASE_REPO_PATH)) return results

  const entries = readdirSync(BASE_REPO_PATH)
  for (const entry of entries) {
    const fullPath = join(BASE_REPO_PATH, entry)
    try {
      const stat = statSync(fullPath)
      if (!stat.isDirectory()) continue

      const svnDir = join(fullPath, '.svn')
      if (!existsSync(svnDir)) continue

      // Get SVN info
      try {
        const { stdout } = await runSvn(['info', '--xml', fullPath])
        const parsed = await parseXml(stdout)
        const info = parsed.info?.entry
        const url = info?.url || ''
        const revision = parseInt(info?.$?.revision || '0')
        const date = info?.commit?.date || new Date().toISOString()
        const author = info?.commit?.author || ''

        // Get status count
        let changesCount = 0
        try {
          const { stdout: st } = await runSvn(['status', '--xml', fullPath])
          const sp = await parseXml(st)
          const target = sp.status?.target
          if (target?.entry) {
            const entries2 = Array.isArray(target.entry) ? target.entry : [target.entry]
            changesCount = entries2.length
          }
        } catch {}

        results.push({
          name: entry,
          path: fullPath,
          url,
          revision,
          lastUpdated: date,
          changesCount,
          author
        })
      } catch {
        results.push({
          name: entry,
          path: fullPath,
          url: '',
          revision: 0,
          lastUpdated: new Date().toISOString(),
          changesCount: 0
        })
      }
    } catch {}
  }
  return results
})

ipcMain.handle('repos:basePath', () => BASE_REPO_PATH)

ipcMain.handle('repos:delete', (_e, repoPath: string) => {
  if (!repoPath.startsWith(BASE_REPO_PATH)) {
    throw new Error('Ruta de repositorio fuera del directorio permitido')
  }
  if (!existsSync(repoPath)) throw new Error('El repositorio no existe')
  rmSync(repoPath, { recursive: true, force: true })
  invalidateLocalRepoUrlIndexCache()
})

// ─── IPC: SVN List (remote) ───────────────────────────────────────────────────
ipcMain.handle('svn:list', async (_e, url: string) => {
  const { stdout } = await runSvn(['list', '--xml', url], { timeoutMs: 30000 })
  const parsed = await parseXml(stdout)
  const list = parsed.lists?.list
  if (!list) return []

  const entries = list.entry
  if (!entries) return []

  const arr = Array.isArray(entries) ? entries : [entries]
  const normalizedBaseUrl = normalizeRepoUrl(url)
  const localRepoUrlIndex = await getLocalRepoUrlIndex()

  return arr.map((e: any) => {
    const name = String(e.name?._?.trim() || e.name || '').replace(/\/$/, '')
    const isDir = e.$?.kind === 'dir'
    const entryUrl = `${normalizedBaseUrl}/${name}`
    const localPath = localRepoUrlIndex.get(normalizeRepoUrl(entryUrl))
    return {
      name,
      url: entryUrl,
      kind: e.$?.kind || 'file',
      revision: parseInt(e.commit?.$?.revision || '0'),
      author: e.commit?.author || '',
      date: e.commit?.date || new Date().toISOString(),
      isCheckedOut: Boolean(localPath) && isDir,
      localPath: localPath && isDir ? localPath : undefined
    }
  })
})

// ─── Search helpers ──────────────────────────────────────────────────────────

// Extensions that cannot contain text — skip in content search
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'psd',
  'jar', 'war', 'ear', 'zip', 'tar', 'gz', 'bz2', '7z', 'rar',
  'class', 'dll', 'so', 'dylib', 'exe', 'obj', 'o', 'a',
  'mp4', 'mp3', 'avi', 'mov', 'mkv', 'wav', 'flac', 'ogg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'bin', 'dat', 'dump',
  'ttf', 'woff', 'woff2', 'eot'
])

// Run at most `concurrency` async tasks simultaneously
async function runConcurrent(
  tasks: Array<() => Promise<void>>,
  concurrency: number
): Promise<void> {
  let nextIdx = 0
  const worker = async () => {
    while (nextIdx < tasks.length) {
      const i = nextIdx++
      await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
}

// Stream `svn cat <url>` and resolve true as soon as `query` is found; kills early
function catSearchFile(fileUrl: string, query: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...buildEnvWithExtraPath(), LANG: 'en_US.UTF-8' } as NodeJS.ProcessEnv
    const confPath = getLegacyOpenSslConfPath()
    if (confPath) env.OPENSSL_CONF = confPath

    const proc = spawn(SVN_BIN, ['cat', fileUrl, ...getSvnAuthArgs()], {
      env
    })

    let buffer = ''
    let settled = false

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timeoutId = setTimeout(() => { proc.kill('SIGTERM'); finish(false) }, 30000)

    proc.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      buffer += chunk.toString('utf-8')
      if (buffer.toLowerCase().includes(query)) {
        clearTimeout(timeoutId)
        proc.kill('SIGTERM')
        finish(true)
        return
      }
      // Prevent memory explosion: keep tail for cross-chunk match detection
      if (buffer.length > 512 * 1024) {
        buffer = buffer.slice(-(query.length + 16))
      }
    })

    proc.on('close', () => { clearTimeout(timeoutId); finish(false) })
    proc.on('error', () => { clearTimeout(timeoutId); finish(false) })
  })
}

// ─── IPC: SVN Search Remote ──────────────────────────────────────────────────
ipcMain.handle('svn:searchRemote', async (event, url: string, query: string, deepSearch: boolean) => {
  const q = (query || '').trim().toLowerCase()
  if (!q) {
    event.sender.send('svn:searchDone', { searched: 0, total: 0 })
    return { ok: true }
  }

  // Step 1 — BFS parallel listing: 5 dirs at a time, 15s timeout each
  // Avoids the single huge svn list --depth infinity call that times out on large repos
  type SearchEntry = { path: string; name: string; kind: 'dir' | 'file'; entryUrl: string }
  const baseUrl = normalizeRepoUrl(url)
  const allEntries: SearchEntry[] = []
  const dirQueue: string[] = [baseUrl]
  let processedDirs = 0
  const LIST_BATCH = 5

  while (dirQueue.length > 0) {
    const batch = dirQueue.splice(0, LIST_BATCH)

    const stdouts = await Promise.all(
      batch.map(async (dirUrl) => {
        try {
          const { stdout } = await runSvn(['list', '--xml', dirUrl], { timeoutMs: 30000 })
          return { dirUrl, stdout }
        } catch {
          return { dirUrl, stdout: null }
        }
      })
    )

    processedDirs += batch.length

    for (const { dirUrl, stdout } of stdouts) {
      if (!stdout) continue
      const parsed = await parseXml(stdout)
      const rawList = parsed.lists?.list
      const listArr = Array.isArray(rawList) ? rawList : (rawList ? [rawList] : [])

      for (const list of listArr) {
        const listPath = normalizeRepoUrl(dirUrl)
        const entries = list.entry
        if (!entries) continue
        const arr = Array.isArray(entries) ? entries : [entries]

        for (const e of arr) {
          const rawName: string = e.name?._?.trim() || (typeof e.name === 'string' ? e.name : '') || ''
          const name = rawName.replace(/\/$/, '')
          if (!name) continue
          const kind: 'dir' | 'file' = e.$?.kind === 'dir' ? 'dir' : 'file'
          const entryUrl = listPath + '/' + name
          const relativePath = entryUrl.replace(new RegExp(`^${escapeRegExp(baseUrl)}/?`), '')
          allEntries.push({ path: relativePath, name, kind, entryUrl })
          if (kind === 'dir') dirQueue.push(entryUrl)
        }
      }
    }

    event.sender.send('svn:searchProgress', {
      searched: 0,
      total: 0,
      listingStats: { dirs: processedDirs, entries: allEntries.length }
    })
  }

  // Step 2 — Name matches: filter + stream immediately to renderer
  const nameResults = allEntries
    .filter(e => e.name.toLowerCase().includes(q))
    .map(e => ({ ...e, matchType: 'name' as const }))

  for (const r of nameResults) {
    event.sender.send('svn:searchResult', r)
  }

  // Step 2b — Search in revision log messages (always, regardless of deepSearch)
  try {
    const { stdout: logStdout } = await runSvn(
      ['log', '--xml', '--limit', '500', url],
      { timeoutMs: 120000 }
    )
    const logParsed = await parseXml(logStdout)
    const logEntries = parseLogEntries(logParsed)

    for (const entry of logEntries) {
      if (entry.message && entry.message.toLowerCase().includes(q)) {
        const preview = entry.message.length > 90
          ? entry.message.slice(0, 90) + '…'
          : entry.message
        event.sender.send('svn:searchResult', {
          path: preview,
          name: `r${entry.revision}`,
          kind: 'revision' as const,
          matchType: 'comment' as const,
          entryUrl: baseUrl,
          revision: entry.revision,
          revisionMessage: entry.message
        })
      }
    }
  } catch {
    // Log search failed silently — continue with name/content results
  }

  if (!deepSearch) {
    event.sender.send('svn:searchDone', { searched: 0, total: 0 })
    return { ok: true }
  }

  // Step 3 — Content search: 8 parallel svn cat streams, no temp dir, early exit per file
  const nameResultPaths = new Set(nameResults.map(r => r.path))
  const fileEntries = allEntries.filter(e =>
    e.kind === 'file' &&
    !nameResultPaths.has(e.path) &&
    !BINARY_EXTENSIONS.has((e.name.split('.').pop() || '').toLowerCase())
  )

  const total = fileEntries.length
  let searched = 0

  event.sender.send('svn:searchProgress', { searched: 0, total })

  const CONCURRENCY = 8
  const tasks = fileEntries.map(entry => async () => {
    const hasMatch = await catSearchFile(entry.entryUrl, q)
    searched++
    if (hasMatch) {
      event.sender.send('svn:searchResult', { ...entry, matchType: 'content' as const })
    }
    event.sender.send('svn:searchProgress', { searched, total })
  })

  await runConcurrent(tasks, CONCURRENCY)
  event.sender.send('svn:searchDone', { searched: total, total })
  return { ok: true }
})

// ─── IPC: SVN Remote actions ────────────────────────────────────────────────
ipcMain.handle('svn:remoteLog', async (_e, url: string, limit = 50) => {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50))
  const { stdout } = await runSvn(
    ['log', '--xml', '--verbose', `--limit=${safeLimit}`, url],
    { timeoutMs: 30000 }
  )
  const parsed = await parseXml(stdout)
  return parseLogEntries(parsed)
})

ipcMain.handle('svn:remoteMkdir', async (_e, parentUrl: string, name: string, message?: string) => {
  const targetUrl = buildRemoteUrl(parentUrl, name)
  const msg = (message || '').trim() || `Crear carpeta ${name.trim()}`
  const { stdout } = await runSvn(
    ['mkdir', targetUrl, '-m', msg],
    { timeoutMs: 30000 }
  )
  return { success: true, url: targetUrl, output: stdout }
})

ipcMain.handle('svn:remoteCreateFile', async (_e, parentUrl: string, name: string, content = '', message?: string) => {
  const targetUrl = buildRemoteUrl(parentUrl, name)
  const msg = (message || '').trim() || `Crear archivo ${name.trim()}`

  const tempDir = mkdtempSync(join(tmpdir(), 'javisvn-'))
  const tempFile = join(tempDir, name.trim())
  writeFileSync(tempFile, content, 'utf-8')

  try {
    const { stdout } = await runSvn(
      ['import', tempFile, targetUrl, '-m', msg],
      { timeoutMs: 30000 }
    )
    return { success: true, url: targetUrl, output: stdout }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

// ─── IPC: SVN Checkout ───────────────────────────────────────────────────────
ipcMain.handle('svn:checkout', async (event, url: string, targetName: string) => {
  const targetWindow = getEventWindow(event)
  const safeTargetName = sanitizeLocalRepoName(targetName)
  const targetPath = join(BASE_REPO_PATH, safeTargetName)

  if (existsSync(targetPath)) {
    throw new Error(`Ya existe un directorio con el nombre "${safeTargetName}"`)
  }

  try {
    await runSvn(
      ['checkout', url, targetPath],
      {
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => sendToWindow(targetWindow, 'svn:checkout-progress', chunk),
        onErrorData: (chunk) => sendToWindow(targetWindow, 'svn:checkout-progress', chunk)
      }
    )
    invalidateLocalRepoUrlIndexCache()
    return { success: true, path: targetPath }
  } catch (err: any) {
    const msg = String(err?.message || '').trim()
    throw new Error(msg || 'Error al descargar el repositorio')
  }
})

// ─── IPC: SVN Export ─────────────────────────────────────────────────────────
ipcMain.handle('svn:export', async (event, url: string, targetPath: string) => {
  const targetWindow = getEventWindow(event)
  if (existsSync(targetPath)) {
    throw new Error(`Ya existe una carpeta en "${targetPath}"`)
  }
  try {
    await runSvn(
      ['export', url, targetPath],
      {
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => sendToWindow(targetWindow, 'svn:export-progress', chunk),
        onErrorData: (chunk) => sendToWindow(targetWindow, 'svn:export-progress', chunk)
      }
    )
    return { success: true, path: targetPath }
  } catch (err: any) {
    const msg = String(err?.message || '').trim()
    throw new Error(msg || 'Error al exportar el repositorio')
  }
})

// ─── IPC: Download single remote file ────────────────────────────────────────
ipcMain.handle('svn:downloadFile', async (_e, url: string, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Guardar archivo',
    defaultPath: defaultName,
    buttonLabel: 'Guardar'
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const targetPath = result.filePath
  try {
    await runSvn(['export', '--force', url, targetPath], { timeoutMs: 5 * 60 * 1000 })
    return { success: true, path: targetPath }
  } catch (err: any) {
    const msg = String(err?.message || '').trim()
    throw new Error(msg || 'Error al descargar el archivo')
  }
})

// ─── IPC: Pick export folder ──────────────────────────────────────────────────
ipcMain.handle('dialog:pickExportFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Seleccionar carpeta de destino',
    buttonLabel: 'Seleccionar'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ─── IPC: SVN Update ─────────────────────────────────────────────────────────
const SSL_TRANSIENT_RE = /svn:\s+E1[12]\d{4}:.*(?:SSL|Unable to connect|Error running context)/i

function filterSslNoise(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !SSL_TRANSIENT_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

ipcMain.handle('svn:update', async (event, repoPath: string) => {
  const targetWindow = getEventWindow(event)
  try {
    const { stdout, stderr } = await runSvn(
      ['update'],
      {
        cwd: repoPath,
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => sendToWindow(targetWindow, 'svn:update-progress', chunk),
        onErrorData: (chunk) => {
          const filtered = filterSslNoise(chunk)
          if (filtered.trim()) sendToWindow(targetWindow, 'svn:update-progress', filtered)
        }
      }
    )
    return { success: true, output: stdout || stderr }
  } catch (err: any) {
    const msg = String(err?.message || '').trim()
    throw new Error(msg || 'Error al actualizar el repositorio')
  }
})

// ─── IPC: SVN Status ─────────────────────────────────────────────────────────
ipcMain.handle('svn:status', async (_e, repoPath: string) => {
  const { stdout } = await runSvn(['status', '--xml'], { cwd: repoPath })
  const parsed = await parseXml(stdout)
  const target = parsed.status?.target
  if (!target?.entry) return []

  const entries = Array.isArray(target.entry) ? target.entry : [target.entry]
  const baseChanges = entries.map((e: any) => {
    const item = e['wc-status']?.$?.item || '?'
    const path = String(e.$?.path || '').replace(/\\/g, '/')
    return {
      path,
      displayPath: path,
      status: mapStatus(item),
      checked: item !== '?'
    }
  })

  const expandedFromUnversionedDirs: Array<{ path: string; displayPath: string; status: string; checked: boolean }> = []

  const walkUnversionedDir = (absDir: string, relDir: string) => {
    try {
      for (const child of readdirSync(absDir, { withFileTypes: true })) {
      if (child.name === '.svn') continue

      const childAbs = join(absDir, child.name)
      const childRel = join(relDir, child.name).replace(/\\/g, '/')

      if (child.isDirectory?.()) {
        expandedFromUnversionedDirs.push({
          path: childRel,
          displayPath: childRel,
          status: '?',
          checked: false
        })
        walkUnversionedDir(childAbs, childRel)
      } else {
        expandedFromUnversionedDirs.push({
          path: childRel,
          displayPath: childRel,
          status: '?',
          checked: false
        })
      }
    }
    } catch {
      return
    }
  }

  for (const change of baseChanges) {
    if (change.status !== '?') continue

    const abs = resolve(repoPath, change.path)
    try {
      const st = statSync(abs)
      if (st.isDirectory()) {
        walkUnversionedDir(abs, change.path)
      }
    } catch {
      // ignore invalid paths
    }
  }

  const merged = new Map<string, { path: string; displayPath: string; status: string; checked: boolean }>()
  for (const c of baseChanges) merged.set(c.path, c)
  for (const c of expandedFromUnversionedDirs) {
    if (!merged.has(c.path)) merged.set(c.path, c)
  }

  return Array.from(merged.values())
})

// ─── IPC: Local file content (for unversioned preview) ──────────────────────
ipcMain.handle('svn:fileContent', async (_e, repoPath: string, filePath: string) => {
  const { targetAbs } = resolveRepoRelativeTarget(repoPath, filePath)

  if (!existsSync(targetAbs)) return '(archivo no encontrado)'
  const st = statSync(targetAbs)
  if (!st.isFile()) return '(no es un archivo regular)'

  try {
    const text = readFileSync(targetAbs, 'utf-8')
    return text || '(archivo vacío)'
  } catch {
    return '(no se pudo leer el contenido del archivo)'
  }
})

ipcMain.handle('svn:getLocalPreviewFile', async (_e, repoPath: string, filePath: string) => {
  const { targetAbs } = resolveRepoRelativeTarget(repoPath, filePath)

  if (!existsSync(targetAbs)) {
    throw new Error('El archivo no existe localmente')
  }
  if (!statSync(targetAbs).isFile()) {
    throw new Error('Solo se pueden previsualizar archivos')
  }

  return buildPreviewFileResponse(targetAbs)
})

ipcMain.handle('svn:getRemotePreviewFile', async (_e, url: string, defaultName?: string) => {
  return exportRemotePreviewFile(url, defaultName)
})

ipcMain.handle('svn:getConflictContent', async (_e, repoPath: string, filePath: string) => {
  const { targetAbs } = resolveRepoRelativeTarget(repoPath, filePath)
  const dirPath = dirname(targetAbs)
  const fileName = basename(targetAbs)
  const minePath = join(dirPath, `${fileName}.mine`)
  const revisionPattern = new RegExp(`^${escapeRegExp(fileName)}\\.r(\\d+)$`)

  const revisionFiles = readdirSync(dirPath)
    .map((entry) => {
      const match = entry.match(revisionPattern)
      if (!match) return null
      return {
        path: join(dirPath, entry),
        revision: Number.parseInt(match[1], 10) || 0
      }
    })
    .filter((x): x is { path: string; revision: number } => x !== null)
    .sort((a, b) => a.revision - b.revision)

  const basePath = revisionFiles[0]?.path || ''
  const theirsPath = revisionFiles[revisionFiles.length - 1]?.path || ''
  const mine = readUtf8IfExists(minePath) || readUtf8IfExists(targetAbs)
  const base = readUtf8IfExists(basePath)
  const theirs = readUtf8IfExists(theirsPath)

  if (!mine && !base && !theirs) {
    throw new Error('No se encontraron archivos auxiliares de conflicto para ese archivo')
  }

  return { mine, base, theirs }
})

function mapStatus(item: string): string {
  const map: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    unversioned: '?',
    conflicted: 'C',
    missing: '!',
    replaced: 'R'
  }
  return map[item] || item[0]?.toUpperCase() || '?'
}

// ─── IPC: SVN Diff ───────────────────────────────────────────────────────────
ipcMain.handle('svn:diff', async (_e, repoPath: string, filePath: string) => {
  try {
    const { stdout } = await runSvn(['diff', filePath], { cwd: repoPath })
    return stdout || '(sin cambios)'
  } catch {
    try {
      const { stdout } = await runSvn(['status', '--xml', filePath], { cwd: repoPath })
      const parsed = await parseXml(stdout)
      const target = parsed.status?.target
      const entry = Array.isArray(target?.entry) ? target.entry[0] : target?.entry
      const item = entry?.['wc-status']?.$?.item || ''
      if (item === 'unversioned') {
        return '(archivo sin versionar: SVN no genera diff hasta hacer add/commit)'
      }
    } catch {
      // ignore secondary error and fallback to generic message
    }
    return '(no se pudo obtener el diff)'
  }
})

ipcMain.handle('svn:blame', async (_e, repoPath: string, filePath: string) => {
  const { targetAbs, relativePath } = resolveRepoRelativeTarget(repoPath, filePath)

  if (!existsSync(targetAbs)) {
    throw new Error('El archivo no existe')
  }
  if (!statSync(targetAbs).isFile()) {
    throw new Error('Blame solo está disponible para archivos')
  }

  const { stdout } = await runSvn(['blame', '--xml', relativePath], {
    cwd: repoPath,
    timeoutMs: 60000
  })
  const parsed = await parseXml(stdout)
  const entries = parsed.blame?.target?.entry
  const blameEntries = entries ? (Array.isArray(entries) ? entries : [entries]) : []
  const normalizedContent = readUtf8IfExists(targetAbs).replace(/\r\n/g, '\n')
  const lines = normalizedContent.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) lines.push('')

  return lines.map((content, index) => {
    const entry = blameEntries[index]
    const commit = entry?.commit
    return {
      lineNum: index + 1,
      revision: Number.parseInt(commit?.$?.revision || '0', 10) || 0,
      author: String(commit?.author || ''),
      date: String(commit?.date || ''),
      content
    }
  })
})

// ─── IPC: SVN Diff at specific revision ──────────────────────────────────────
ipcMain.handle('svn:revisionFileDiff', async (_e, repoPath: string, revision: number, svnPath: string) => {
  // Get the repository root URL from the working copy
  const { stdout: infoXml } = await runSvn(['info', '--xml'], { cwd: repoPath })
  const parsed = await xml2js.parseStringPromise(infoXml, { explicitArray: false })
  const rootUrl: string = parsed?.info?.entry?.repository?.root || ''
  if (!rootUrl) throw new Error('No se pudo obtener la URL raíz del repositorio')

  const fileUrl = rootUrl + svnPath
  try {
    const { stdout } = await runSvn([
      'diff',
      `-c${revision}`,
      '-x', '-U 9999',
      fileUrl
    ])
    return stdout || '(sin cambios en esta revisión)'
  } catch (err: any) {
    const msg = String(err?.message || '')
    if (msg.includes('was added') || msg.includes('E195020')) {
      // File was added in this revision — diff against empty
      return `(archivo añadido en r${revision})`
    }
    throw err
  }
})

// ─── IPC: SVN Commit ─────────────────────────────────────────────────────────
ipcMain.handle('svn:commit', async (_e, repoPath: string, files: string[], message: string) => {
  // Add unversioned files first
  const statusResult = await runSvn(['status', '--xml'], { cwd: repoPath })
  const parsed = await parseXml(statusResult.stdout)
  const target = parsed.status?.target

  const normalizePathKey = (inputPath: string): string => {
    const normalized = String(inputPath || '').replace(/\\/g, '/').trim()
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  const selected = Array.from(new Set(files.map((f) => String(f || '').trim()).filter(Boolean)))
  const selectedKeyToOriginal = new Map<string, string>()
  selected.forEach((f) => selectedKeyToOriginal.set(normalizePathKey(f), f))

  const statusByPathKey = new Map<string, string>()
  const pathKeyToPath = new Map<string, string>()
  if (target?.entry) {
    const entries = Array.isArray(target.entry) ? target.entry : [target.entry]
    for (const e of entries) {
      const item = String(e['wc-status']?.$?.item || '')
      const p = String(e.$?.path || '')
      if (!p) continue
      const key = normalizePathKey(p)
      statusByPathKey.set(key, item)
      pathKeyToPath.set(key, p)
    }

    const toAddSet = new Set<string>()

    // 1) Explicitly unversioned entries reported by SVN status
    for (const [pathKey, item] of statusByPathKey.entries()) {
      if (item !== 'unversioned') continue
      const selectedOriginal = selectedKeyToOriginal.get(pathKey)
      if (selectedOriginal) toAddSet.add(selectedOriginal)
    }

    // 2) Expanded entries that may not appear in SVN XML (e.g. files inside new dirs)
    for (const selectedPath of selected) {
      const key = normalizePathKey(selectedPath)
      const known = statusByPathKey.get(key)
      if (known) continue

      const abs = resolve(repoPath, selectedPath)
      if (existsSync(abs)) {
        toAddSet.add(selectedPath)
      }
    }

    const toAdd = Array.from(toAddSet)

    if (toAdd.length > 0) {
      await runSvn(['add', '--force', '--parents', ...toAdd], { cwd: repoPath })
    }

    // Re-read status after add so we can include any required added parent dirs
    const statusAfterAdd = await runSvn(['status', '--xml'], { cwd: repoPath })
    const parsedAfterAdd = await parseXml(statusAfterAdd.stdout)
    const targetAfterAdd = parsedAfterAdd.status?.target
    const statusAfterByPathKey = new Map<string, string>()
    const pathAfterKeyToPath = new Map<string, string>()

    if (targetAfterAdd?.entry) {
      const entriesAfter = Array.isArray(targetAfterAdd.entry) ? targetAfterAdd.entry : [targetAfterAdd.entry]
      for (const e of entriesAfter) {
        const item = String(e['wc-status']?.$?.item || '')
        const p = String(e.$?.path || '')
        if (!p) continue
        const key = normalizePathKey(p)
        statusAfterByPathKey.set(key, item)
        pathAfterKeyToPath.set(key, p)
      }
    }

    const commitSet = new Set(selected)
    const isPathAncestor = (ancestor: string, descendant: string) => {
      const a = normalizePathKey(ancestor).replace(/\/+$/g, '')
      const d = normalizePathKey(descendant)
      return d === a || d.startsWith(`${a}/`)
    }

    // If a selected path is under a newly added parent dir, include that parent in commit targets.
    for (const [key, item] of statusAfterByPathKey.entries()) {
      if (item !== 'added') continue
      const parentPath = pathAfterKeyToPath.get(key)
      if (!parentPath) continue

      for (const selectedPath of selected) {
        if (isPathAncestor(parentPath, selectedPath) && normalizePathKey(parentPath) !== normalizePathKey(selectedPath)) {
          commitSet.add(parentPath)
          break
        }
      }
    }

    const commitTargets = Array.from(commitSet)

    const { stdout } = await runSvn(
      ['commit', ...commitTargets, '-m', message],
      { cwd: repoPath }
    )
    return { success: true, output: stdout }
  }

  const { stdout } = await runSvn(
    ['commit', ...selected, '-m', message],
    { cwd: repoPath }
  )
  return { success: true, output: stdout }
})

// ─── IPC: SVN Revert ─────────────────────────────────────────────────────────
ipcMain.handle('svn:revert', async (_e, repoPath: string, files: string[]) => {
  const { stdout } = await runSvn(['revert', '--recursive', ...files], { cwd: repoPath })
  return { success: true, output: stdout }
})

ipcMain.handle('svn:resolve', async (_e, repoPath: string, filePath: string, accept: string) => {
  const safeAccept = String(accept || '').trim()
  if (safeAccept !== 'mine-full' && safeAccept !== 'theirs-full' && safeAccept !== 'working') {
    throw new Error('Resolución no soportada')
  }

  const { relativePath } = resolveRepoRelativeTarget(repoPath, filePath)
  const { stdout } = await runSvn(['resolve', '--accept', safeAccept, relativePath], {
    cwd: repoPath
  })
  return { success: true, output: stdout }
})

// ─── IPC: SVN Log ────────────────────────────────────────────────────────────
ipcMain.handle('svn:log', async (_e, repoPath: string, limit = 50, fromRevision?: number) => {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50))
  const safeFromRevision = Number(fromRevision)
  const args = ['log', '--xml', '--verbose', `--limit=${safeLimit}`]
  if (Number.isFinite(safeFromRevision) && safeFromRevision > 0) {
    args.push('-r', `${Math.floor(safeFromRevision)}:1`)
  } else {
    args.push('-r', 'HEAD:1')
  }

  const { stdout } = await runSvn(args, { cwd: repoPath })
  const parsed = await parseXml(stdout)
  const entries = parsed.log?.logentry
  if (!entries) return []

  const arr = Array.isArray(entries) ? entries : [entries]
  return arr.map((e: any) => {
    let paths: any[] = []
    if (e.paths?.path) {
      paths = Array.isArray(e.paths.path) ? e.paths.path : [e.paths.path]
    }
    return {
      revision: parseInt(e.$?.revision || '0'),
      author: e.author || '',
      date: e.date || '',
      message: e.msg || '',
      paths: paths.map((p: any) => ({
        path: typeof p === 'string' ? p : p._ || '',
        action: p.$?.action || 'M'
      }))
    }
  })
})

// ─── IPC: SVN Cat (remote file content) ──────────────────────────────────────
ipcMain.handle('svn:cat', async (_e, url: string) => {
  const { stdout } = await runSvn(['cat', url])
  if (stdout.length > 500_000) {
    return stdout.slice(0, 500_000) + '\n\n[... contenido truncado a 500 KB ...]'
  }
  return stdout
})

// ─── IPC: SVN Repo Root URL ──────────────────────────────────────────────────
ipcMain.handle('svn:getRepoRoot', async (_e, url: string) => {
  const { stdout } = await runSvn(['info', '--xml', url])
  const parsed = await xml2js.parseStringPromise(stdout, { explicitArray: false })
  return (parsed?.info?.entry?.repository?.root as string) || null
})

// ─── IPC: SVN Remote Diff at specific revision ───────────────────────────────
ipcMain.handle('svn:remoteRevisionDiff', async (_e, baseUrl: string, svnPath: string, revision: number) => {
  const { stdout: infoXml } = await runSvn(['info', '--xml', baseUrl])
  const parsed = await xml2js.parseStringPromise(infoXml, { explicitArray: false })
  const rootUrl: string = parsed?.info?.entry?.repository?.root || ''
  if (!rootUrl) throw new Error('No se pudo obtener la URL raíz del repositorio')

  const fileUrl = rootUrl + svnPath
  try {
    const { stdout } = await runSvn(['diff', `-c${revision}`, '-x', '-U 9999', fileUrl])
    return stdout || '(sin cambios en esta revisión)'
  } catch (err: any) {
    const msg = String(err?.message || '')
    if (msg.includes('was added') || msg.includes('E195020')) {
      return `(archivo añadido en r${revision})`
    }
    throw err
  }
})

// ─── IPC: SVN Info ───────────────────────────────────────────────────────────
ipcMain.handle('svn:info', async (_e, path: string) => {
  const { stdout } = await runSvn(['info', '--xml', path])
  const parsed = await parseXml(stdout)
  const entry = parsed.info?.entry
  return {
    url: entry?.url || '',
    revision: parseInt(entry?.$?.revision || '0'),
    author: entry?.commit?.author || '',
    date: entry?.commit?.date || '',
    rootUrl: entry?.repository?.root || ''
  }
})

// ─── IPC: Dialog ─────────────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_e, repoPath: string, filePath: string) => {
  shell.openPath(join(repoPath, filePath))
})

ipcMain.handle('dialog:openFolder', async (_e, path: string) => {
  shell.openPath(path)
})

ipcMain.handle('dialog:listEditors', async () => {
  return detectEditors().map(({ id, label }) => ({ id, label }))
})

ipcMain.handle('dialog:openInEditor', async (_e, editorId: string, repoPath: string) => {
  const safeEditorId = (editorId || '').trim()
  const safeRepoPath = (repoPath || '').trim()
  if (!safeRepoPath.startsWith(BASE_REPO_PATH)) {
    throw new Error('Ruta de repositorio fuera del directorio permitido')
  }
  if (safeEditorId !== 'vscode' && safeEditorId !== 'vscode-insiders') {
    throw new Error('Editor no soportado')
  }

  openRepoInEditor(safeEditorId, safeRepoPath)
  return true
})

// ─── IPC: SVN test connection ────────────────────────────────────────────────
ipcMain.handle('svn:ping', async (_e, url: string) => {
  try {
    await runSvn(['info', '--xml', url], { timeoutMs: 15000 })
    return { ok: true }
  } catch (err: any) {
    const msg = err.message || ''
    if (msg.includes('Authentication') || msg.includes('authorization') || msg.includes('E170001')) {
      return { ok: false, authError: true, message: msg }
    }
    return { ok: false, authError: false, message: msg }
  }
})

// Ping usando credenciales inline — sin persistir en el store
ipcMain.handle('svn:pingWithCreds', async (_e, creds: { url: string; username: string; password: string }) => {
  const inlineAuthArgs = [
    '--non-interactive',
    '--trust-server-cert',
    '--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other',
    '--username', creds.username,
    '--password', creds.password
  ]
  try {
    await runSvn(['info', '--xml', creds.url, ...inlineAuthArgs], { skipAuth: true, timeoutMs: 15000 })
    return { ok: true }
  } catch (err: any) {
    const msg = err.message || ''
    if (msg.includes('Authentication') || msg.includes('authorization') || msg.includes('E170001')) {
      return { ok: false, authError: true, message: msg }
    }
    return { ok: false, authError: false, message: msg }
  }
})

// ─── IPC: Get SVN binary info ────────────────────────────────────────────────
ipcMain.handle('svn:version', async () => {
  try {
    const { stdout } = await runSvn(['--version', '--quiet'], { skipAuth: true })
    return { version: stdout.trim(), bin: SVN_BIN }
  } catch {
    return { version: null, bin: SVN_BIN }
  }
})

// ─── IPC: Install SVN via Homebrew (fallback) ────────────────────────────────
ipcMain.handle('svn:install', async (event) => {
  const targetWindow = getEventWindow(event)
  if (process.platform === 'win32') {
    throw new Error('En Windows, JaviSVN incluye SVN integrado. Si hay problemas, descarga TortoiseSVN desde https://tortoisesvn.net')
  }

  return new Promise((resolve, reject) => {
    const brewBin = existsSync('/opt/homebrew/bin/brew')
      ? '/opt/homebrew/bin/brew'
      : '/usr/local/bin/brew'

    if (!existsSync(brewBin)) {
      reject(new Error('Homebrew no está instalado. Visita https://brew.sh'))
      return
    }

    const extraPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    const proc = spawn(brewBin, ['install', 'subversion'], {
      env: { ...process.env, PATH: extraPath }
    })

    proc.stdout.on('data', (d: Buffer) => {
      sendToWindow(targetWindow, 'svn:install-progress', d.toString())
    })
    proc.stderr.on('data', (d: Buffer) => {
      sendToWindow(targetWindow, 'svn:install-progress', d.toString())
    })
    proc.on('close', (code) => {
      if (code === 0) {
        // Refresh SVN_BIN after install
        SVN_BIN = findSvnBin()
        resolve({ success: true, bin: SVN_BIN })
      } else {
        reject(new Error('Error al instalar SVN via Homebrew'))
      }
    })
    proc.on('error', reject)
  })
})
