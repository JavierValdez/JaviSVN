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
const DEFAULT_SERVER_URL = 'https://linrepo00.sat-interno.gob.gt/svn'
const DEFAULT_SVN_CANDIDATES = [
  '/opt/homebrew/bin/svn',
  '/usr/local/bin/svn',
  '/usr/bin/svn',
  '/opt/local/bin/svn',
]

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
ipcMain.handle('svn:update', async (_e, repoPath: string) => {
  try {
    const { stdout, stderr } = await runSvn(
      ['update'],
      {
        cwd: repoPath,
        timeoutMs: 10 * 60 * 1000,
        onData: (chunk) => mainWindow.webContents.send('svn:update-progress', chunk),
        onErrorData: (chunk) => mainWindow.webContents.send('svn:update-progress', chunk)
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
ipcMain.handle('svn:log', async (_e, repoPath: string, limit = 50) => {
  const { stdout } = await runSvn(
    ['log', '--xml', '--verbose', `--limit=${limit}`],
    { cwd: repoPath }
  )
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
