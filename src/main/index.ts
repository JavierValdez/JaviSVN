import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { createRequire } from 'module'
import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'

const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xml2js = _require('xml2js') as any
const parseStringPromise = xml2js.parseStringPromise

const isDev = process.env.NODE_ENV === 'development'
const DEFAULT_SERVER_URL = ''
const DEFAULT_SVN_CANDIDATES = [
  '/opt/homebrew/bin/svn',
  '/usr/local/bin/svn',
  '/usr/bin/svn',
  '/opt/local/bin/svn',
]
const EXTRA_PATH_SEGMENTS = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'

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

function getStoredCredentials(): { username?: string; password?: string; serverUrl?: string } | null {
  const creds = storeGet('credentials')
  if (!creds || typeof creds !== 'object') return null
  return creds as { username?: string; password?: string; serverUrl?: string }
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

function getStoredRemotes(): StoredRemote[] {
  const raw = storeGet('remoteServers')
  if (!Array.isArray(raw)) return []

  return raw
    .filter((x: any) => x && typeof x === 'object' && x.id && x.name && x.url)
    .map((x: any) => ({
      id: String(x.id),
      name: String(x.name),
      url: String(x.url),
      createdAt: String(x.createdAt || new Date().toISOString())
    }))
}

function saveStoredRemotes(remotes: StoredRemote[]): void {
  storeSet('remoteServers', remotes)
}

function ensureRemotesSeeded(): StoredRemote[] {
  const existing = getStoredRemotes()
  if (existing.length > 0) return existing

  const seeded: StoredRemote[] = [{
    id: `remote-${Date.now()}`,
    name: 'Servidor principal',
    url: getCurrentServerUrl(),
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

// ─── Find svn binary ─────────────────────────────────────────────────────────
function canExecuteSvn(bin: string): boolean {
  const extraPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
  const currentPath = process.env.PATH || ''
  const mergedPath = currentPath.includes('/opt/homebrew/bin') ? currentPath : `${extraPath}:${currentPath}`
  try {
    const result = spawnSync(bin, ['--version', '--quiet'], {
      env: { ...process.env, LANG: 'en_US.UTF-8', PATH: mergedPath },
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

function buildEnvWithExtraPath(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH || ''
  const mergedPath = currentPath.includes('/opt/homebrew/bin')
    ? currentPath
    : `${EXTRA_PATH_SEGMENTS}:${currentPath}`
  return { ...process.env, PATH: mergedPath }
}

function findSvnBin(preferred?: string): string {
  // 1. Bundled binary (packaged app: Contents/Resources/bin/svn)
  const bundledPackaged = join(process.resourcesPath || '', 'bin', 'svn')
  // 2. Bundled binary (dev mode: project/resources/bin/svn)
  const bundledDev = join(__dirname, '../../resources/bin/svn')

  const preferredValues = [preferred || '', process.env.JAVISVN_SVN_BIN || '']

  // For distributed app, prefer embedded SVN to avoid external dependencies.
  // For dev, prefer system SVN first to avoid local packaged-binary issues.
  const candidates = app.isPackaged
    ? uniqueStrings([
      ...preferredValues,
      bundledPackaged,
      bundledDev,
      ...DEFAULT_SVN_CANDIDATES,
      'svn'
    ])
    : uniqueStrings([
      ...preferredValues,
      ...DEFAULT_SVN_CANDIDATES,
      bundledPackaged,
      bundledDev,
      'svn'
    ])

  for (const c of candidates) {
    if (c !== 'svn' && !existsSync(c)) continue
    if (canExecuteSvn(c)) return c
  }
  return 'svn'
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

function runCommand(command: string, args: string[], options: { shell?: boolean } = {}): boolean {
  const result = spawnSync(command, args, {
    env: buildEnvWithExtraPath(),
    stdio: 'ignore',
    windowsHide: true,
    shell: options.shell || false,
    timeout: 10000
  })
  return !result.error && result.status === 0
}

function openRepoInEditor(editorId: SupportedEditorId, repoPath: string): void {
  const safePath = (repoPath || '').trim()
  if (!safePath) throw new Error('Ruta de repositorio inválida')
  if (!existsSync(safePath)) throw new Error('El repositorio no existe')
  if (!statSync(safePath).isDirectory()) throw new Error('La ruta no es una carpeta')

  const editor = detectEditors().find((x) => x.id === editorId)
  if (!editor) throw new Error('Ese editor no está disponible en este equipo')

  if (editor.command && runCommand(editor.command, [safePath], { shell: process.platform === 'win32' })) return
  if (process.platform === 'darwin' && editor.macAppPath && runCommand('open', ['-a', editor.macAppPath, safePath])) return
  if (process.platform === 'win32' && editor.winExecutablePath && runCommand(editor.winExecutablePath, [safePath])) return

  throw new Error(`No se pudo abrir el repositorio en ${editor.label}`)
}

// ─── Main Window ─────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow

function createWindow(): void {
  const preloadCandidates = [
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js')
  ]
  const preloadPath = preloadCandidates.find((p) => existsSync(p)) || preloadCandidates[0]

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.javisvn.app')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
  const creds = storeGet('credentials') as { username: string; password: string } | undefined
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
  if (process.platform === 'win32') return null
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
    const extraPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    const currentPath = process.env.PATH || ''
    const mergedPath = currentPath.includes('/opt/homebrew/bin') ? currentPath : `${extraPath}:${currentPath}`
    const env = { ...process.env, LANG: 'en_US.UTF-8', PATH: mergedPath } as NodeJS.ProcessEnv
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

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const cmd = args[0] || 'svn'
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!settled) proc.kill('SIGKILL')
        }, 1500)
        finishReject(new Error(`Tiempo de espera agotado (${Math.ceil(options.timeoutMs / 1000)}s) al ejecutar SVN (${cmd})`))
      }, options.timeoutMs)
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
  const shouldFallback = options.allowLegacySslFallback !== false
  const firstTryLegacy = options.forceLegacySsl === true

  try {
    return await runSvnOnce(args, options, firstTryLegacy)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (!firstTryLegacy && shouldFallback && isLegacySslError(message)) {
      return runSvnOnce(args, options, true)
    }
    throw err
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
  return storeGet('credentials') || null
})

ipcMain.handle('creds:set', (_e, creds: { username: string; password: string; serverUrl: string }) => {
  storeSet('credentials', creds)
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

  // Get local repos to check which are already checked out
  const localEntries = existsSync(BASE_REPO_PATH) ? readdirSync(BASE_REPO_PATH) : []
  const localRepoNames = new Set(localEntries.map((e) => e.toLowerCase()))

  return arr.map((e: any) => {
    const name = e.name?._?.trim() || e.name || ''
    const isDir = e.$?.kind === 'dir'
    const repoName = isDir ? name.replace(/\/$/, '') : name
    return {
      name,
      url: url.replace(/\/$/, '') + '/' + name,
      kind: e.$?.kind || 'file',
      revision: parseInt(e.commit?.$?.revision || '0'),
      author: e.commit?.author || '',
      date: e.commit?.date || new Date().toISOString(),
      isCheckedOut: localRepoNames.has(repoName.toLowerCase()),
      localPath: localRepoNames.has(repoName.toLowerCase())
        ? join(BASE_REPO_PATH, repoName)
        : undefined
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
    const extraPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    const currentPath = process.env.PATH || ''
    const mergedPath = currentPath.includes('/opt/homebrew/bin')
      ? currentPath
      : `${extraPath}:${currentPath}`

    const proc = spawn(SVN_BIN, ['cat', fileUrl, ...getSvnAuthArgs()], {
      env: { ...process.env, LANG: 'en_US.UTF-8', PATH: mergedPath }
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
  const baseUrl = url.replace(/\/$/, '')
  const allEntries: SearchEntry[] = []
  const dirQueue: string[] = [url]
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
        const listPath = ((list.$?.path as string) || dirUrl).replace(/\/$/, '')
        const entries = list.entry
        if (!entries) continue
        const arr = Array.isArray(entries) ? entries : [entries]

        for (const e of arr) {
          const rawName: string = e.name?._?.trim() || (typeof e.name === 'string' ? e.name : '') || ''
          const name = rawName.replace(/\/$/, '')
          if (!name) continue
          const kind: 'dir' | 'file' = e.$?.kind === 'dir' ? 'dir' : 'file'
          const entryUrl = listPath + '/' + name
          const relativePath = entryUrl.replace(baseUrl, '').replace(/^\//, '')
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
          entryUrl: url,
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
ipcMain.handle('svn:checkout', async (_e, url: string, targetName: string) => {
  const targetPath = join(BASE_REPO_PATH, targetName)

  if (existsSync(targetPath)) {
    throw new Error(`Ya existe un directorio con el nombre "${targetName}"`)
  }

  try {
    await runSvn(
      ['checkout', url, targetPath],
      {
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => mainWindow.webContents.send('svn:checkout-progress', chunk),
        onErrorData: (chunk) => mainWindow.webContents.send('svn:checkout-progress', chunk)
      }
    )
    return { success: true, path: targetPath }
  } catch (err: any) {
    const msg = String(err?.message || '').trim()
    throw new Error(msg || 'Error al descargar el repositorio')
  }
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

ipcMain.handle('svn:update', async (_e, repoPath: string) => {
  try {
    const { stdout, stderr } = await runSvn(
      ['update'],
      {
        cwd: repoPath,
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => mainWindow.webContents.send('svn:update-progress', chunk),
        onErrorData: (chunk) => {
          const filtered = filterSslNoise(chunk)
          if (filtered.trim()) mainWindow.webContents.send('svn:update-progress', filtered)
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
  return entries.map((e: any) => {
    const item = e['wc-status']?.$?.item || '?'
    const path = e.$?.path || ''
    return {
      path,
      displayPath: path,
      status: mapStatus(item),
      checked: item !== '?'
    }
  })
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
    return '(no se pudo obtener el diff)'
  }
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
  if (target?.entry) {
    const entries = Array.isArray(target.entry) ? target.entry : [target.entry]
    const toAdd = entries
      .filter((e: any) => {
        const item = e['wc-status']?.$?.item
        const p = e.$?.path
        return item === 'unversioned' && files.includes(p)
      })
      .map((e: any) => e.$?.path)

    if (toAdd.length > 0) {
      await runSvn(['add', '--force', ...toAdd], { cwd: repoPath })
    }
  }

  const { stdout } = await runSvn(
    ['commit', ...files, '-m', message],
    { cwd: repoPath }
  )
  return { success: true, output: stdout }
})

// ─── IPC: SVN Revert ─────────────────────────────────────────────────────────
ipcMain.handle('svn:revert', async (_e, repoPath: string, files: string[]) => {
  const { stdout } = await runSvn(['revert', '--recursive', ...files], { cwd: repoPath })
  return { success: true, output: stdout }
})

// ─── IPC: SVN Log ────────────────────────────────────────────────────────────
ipcMain.handle('svn:log', async (_e, repoPath: string, limit = 50, fromRevision?: number) => {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50))
  const safeFromRevision = Number(fromRevision)
  const args = ['log', '--xml', '--verbose', `--limit=${safeLimit}`]
  if (Number.isFinite(safeFromRevision) && safeFromRevision > 0) {
    args.push('-r', `${Math.floor(safeFromRevision)}:1`)
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
ipcMain.handle('svn:install', async () => {
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
      mainWindow.webContents.send('svn:install-progress', d.toString())
    })
    proc.stderr.on('data', (d: Buffer) => {
      mainWindow.webContents.send('svn:install-progress', d.toString())
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
