import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ensureRemotesSeeded, StoredRemote } from './store'
import { getSvnSpawnContext, runSvn } from './svn-runtime'
import { spawn } from 'node:child_process'
import { BASE_REPO_PATH } from './local-paths'

const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xml2js = _require('xml2js') as any
const parseStringPromise = xml2js.parseStringPromise

export { BASE_REPO_PATH } from './local-paths'
export {
  MAX_TEXT_RESULT_LENGTH,
  buildHistoricalRemoteTarget,
  buildRepoId,
  normalizeRemoteRevision,
  normalizeRelativePath,
  normalizeRepoUrl,
  resolveRepoRelativeTarget,
  truncateText,
  validateReadOnlyRemoteUrl
} from './read-contract'
export type { TextResult } from './read-contract'
import {
  buildHistoricalRemoteTarget,
  buildRepoId,
  normalizeRelativePath,
  normalizeRepoUrl,
  resolveRepoRelativeTarget,
  type TextResult,
  truncateText,
  validateReadOnlyRemoteUrl
} from './read-contract'

export type LocalChangeStatus = 'M' | 'A' | 'D' | '?' | 'C' | '!' | 'R' | 'I'

export interface LocalStatusChange {
  path: string
  displayPath: string
  status: LocalChangeStatus
  checked: boolean
  kind: 'file' | 'dir'
  rawStatus: string
  wcLocked: boolean
}

export interface LocalRepoSummary {
  id: string
  name: string
  path: string
  url: string
  revision: number
  lastUpdated: string
  changesCount: number
  author?: string
}

export interface SearchProgress {
  searched: number
  total: number
  listingStats?: { dirs: number; entries: number }
}

export interface RemoteSearchResult {
  path: string
  name: string
  kind: 'dir' | 'file' | 'revision'
  matchType: 'name' | 'content' | 'comment'
  entryUrl: string
  revision?: number
  revisionMessage?: string
}

export interface RemoteSearchResponse {
  results: RemoteSearchResult[]
  searched: number
  total: number
  truncated: boolean
}

async function parseXml(xml: string): Promise<any> {
  return parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: false
  })
}

export function parseLogEntries(parsed: any): any[] {
  const entries = parsed.log?.logentry
  if (!entries) return []
  const arr = Array.isArray(entries) ? entries : [entries]
  return arr.map((entry: any) => {
    let paths: any[] = []
    if (entry.paths?.path) {
      paths = Array.isArray(entry.paths.path) ? entry.paths.path : [entry.paths.path]
    }
    return {
      revision: parseInt(entry.$?.revision || '0'),
      author: entry.author || '',
      date: entry.date || '',
      message: entry.msg || '',
      paths: paths.map((path: any) => ({
        path: typeof path === 'string' ? path : path._ || '',
        action: path.$?.action || 'M'
      }))
    }
  })
}

function normalizeStatusEntryPath(repoPath: string, entryPath: string): string {
  const rawPath = String(entryPath || '.').replace(/\\/g, '/')
  if (!rawPath || rawPath === '.') return '.'
  if (isAbsolute(rawPath)) {
    const rel = relative(resolve(repoPath), rawPath).replace(/\\/g, '/')
    return normalizeRelativePath(rel) || '.'
  }
  return normalizeRelativePath(rawPath) || '.'
}

function detectStatusEntryKind(repoPath: string, relPath: string): 'file' | 'dir' {
  try {
    const abs = relPath === '.' ? resolve(repoPath) : resolve(repoPath, relPath)
    return existsSync(abs) && statSync(abs).isDirectory() ? 'dir' : 'file'
  } catch {
    return 'file'
  }
}

function mapStatus(item: string, props = 'none'): LocalChangeStatus | null {
  const safeItem = String(item || 'normal')
  const safeProps = String(props || 'none')
  if (safeItem === 'normal') {
    if (safeProps === 'modified') return 'M'
    if (safeProps === 'conflicted') return 'C'
    return null
  }

  const map: Record<string, LocalChangeStatus> = {
    modified: 'M',
    merged: 'M',
    added: 'A',
    deleted: 'D',
    unversioned: '?',
    conflicted: 'C',
    missing: '!',
    obstructed: '!',
    replaced: 'R',
    incomplete: 'I'
  }

  if (safeItem === 'none' || safeItem === 'ignored' || safeItem === 'external') return null
  return map[safeItem] || '?'
}

export function buildStatusChangesFromParsed(parsed: any, repoPath: string): LocalStatusChange[] {
  const target = parsed.status?.target
  if (!target?.entry) return []

  const entries = Array.isArray(target.entry) ? target.entry : [target.entry]
  const baseChanges: LocalStatusChange[] = []
  for (const entry of entries) {
    const wcStatus = entry['wc-status']?.$ || {}
    const item = String(wcStatus.item || 'normal')
    const props = String(wcStatus.props || 'none')
    const status = mapStatus(item, props)
    if (!status) continue

    const path = normalizeStatusEntryPath(repoPath, entry.$?.path)
    baseChanges.push({
      path,
      displayPath: path,
      status,
      checked: status !== '?' && status !== 'I',
      kind: detectStatusEntryKind(repoPath, path),
      rawStatus: item,
      wcLocked: String(wcStatus['wc-locked'] || '') === 'true'
    })
  }

  const expandedFromUnversionedDirs: LocalStatusChange[] = []
  const walkUnversionedDir = (absDir: string, relDir: string) => {
    try {
      for (const child of readdirSync(absDir, { withFileTypes: true })) {
        if (child.name === '.svn') continue
        const childAbs = join(absDir, child.name)
        const childRel = join(relDir === '.' ? '' : relDir, child.name).replace(/\\/g, '/')
        if (child.isDirectory?.()) {
          expandedFromUnversionedDirs.push({
            path: childRel,
            displayPath: childRel,
            status: '?',
            checked: false,
            kind: 'dir',
            rawStatus: 'unversioned',
            wcLocked: false
          })
          walkUnversionedDir(childAbs, childRel)
        } else {
          expandedFromUnversionedDirs.push({
            path: childRel,
            displayPath: childRel,
            status: '?',
            checked: false,
            kind: 'file',
            rawStatus: 'unversioned',
            wcLocked: false
          })
        }
      }
    } catch {
      return
    }
  }

  for (const change of baseChanges) {
    if (change.status !== '?') continue
    const abs = change.path === '.' ? resolve(repoPath) : resolve(repoPath, change.path)
    try {
      if (statSync(abs).isDirectory()) walkUnversionedDir(abs, change.path)
    } catch {
      // ignore invalid paths
    }
  }

  const merged = new Map<string, LocalStatusChange>()
  for (const change of baseChanges) merged.set(change.path, change)
  for (const change of expandedFromUnversionedDirs) {
    if (!merged.has(change.path)) merged.set(change.path, change)
  }
  return Array.from(merged.values())
}

export async function listLocalRepos(): Promise<LocalRepoSummary[]> {
  const results: LocalRepoSummary[] = []
  if (!existsSync(BASE_REPO_PATH)) return results

  for (const entry of readdirSync(BASE_REPO_PATH)) {
    const fullPath = join(BASE_REPO_PATH, entry)
    try {
      if (!statSync(fullPath).isDirectory()) continue
      if (!existsSync(join(fullPath, '.svn'))) continue

      try {
        const { stdout } = await runSvn(['info', '--xml', fullPath])
        const parsed = await parseXml(stdout)
        const info = parsed.info?.entry
        let changesCount = 0
        try {
          const { stdout: statusXml } = await runSvn(['status', '--xml', fullPath])
          changesCount = buildStatusChangesFromParsed(await parseXml(statusXml), fullPath).length
        } catch {
          changesCount = 0
        }

        results.push({
          id: buildRepoId(fullPath),
          name: entry,
          path: fullPath,
          url: info?.url || '',
          revision: parseInt(info?.$?.revision || '0'),
          lastUpdated: info?.commit?.date || new Date().toISOString(),
          changesCount,
          author: info?.commit?.author || ''
        })
      } catch {
        results.push({
          id: buildRepoId(fullPath),
          name: entry,
          path: fullPath,
          url: '',
          revision: 0,
          lastUpdated: new Date().toISOString(),
          changesCount: 0
        })
      }
    } catch {
      // ignore invalid entries
    }
  }
  return results
}

export async function resolveLocalRepo(repoId: string): Promise<LocalRepoSummary> {
  const repo = (await listLocalRepos()).find((candidate) => candidate.id === repoId)
  if (!repo) throw new Error('Repositorio local no encontrado')
  return repo
}

export async function getLocalRepoUrlIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  for (const repo of await listLocalRepos()) {
    const normalized = normalizeRepoUrl(repo.url)
    if (normalized) index.set(normalized, repo.path)
  }
  return index
}

export async function listRemote(url: string, revision?: number): Promise<any[]> {
  const target = buildHistoricalRemoteTarget(url, revision)
  const { stdout } = await runSvn(
    ['list', '--xml', ...target.revisionArgs, target.targetUrl],
    { timeoutMs: 30000 }
  )
  const parsed = await parseXml(stdout)
  const list = parsed.lists?.list
  if (!list) return []
  const entries = list.entry
  if (!entries) return []

  const arr = Array.isArray(entries) ? entries : [entries]
  const normalizedBaseUrl = normalizeRepoUrl(target.safeUrl)
  const localRepoUrlIndex = await getLocalRepoUrlIndex()
  const isDirectFileListing = arr.length === 1
    && String(arr[0]?.$?.kind || '') === 'file'
    && basename(normalizedBaseUrl) === String(arr[0]?.name?._?.trim() || arr[0]?.name || '').replace(/\/$/, '')

  return arr.map((entry: any) => {
    const name = String(entry.name?._?.trim() || entry.name || '').replace(/\/$/, '')
    const isDir = entry.$?.kind === 'dir'
    const entryUrl = isDirectFileListing ? normalizedBaseUrl : `${normalizedBaseUrl}/${name}`
    const localPath = localRepoUrlIndex.get(normalizeRepoUrl(entryUrl))
    return {
      name,
      url: entryUrl,
      kind: entry.$?.kind || 'file',
      revision: parseInt(entry.commit?.$?.revision || '0'),
      author: entry.commit?.author || '',
      date: entry.commit?.date || new Date().toISOString(),
      isCheckedOut: Boolean(localPath) && isDir,
      localPath: localPath && isDir ? localPath : undefined
    }
  })
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'psd',
  'jar', 'war', 'ear', 'zip', 'tar', 'gz', 'bz2', '7z', 'rar',
  'class', 'dll', 'so', 'dylib', 'exe', 'obj', 'o', 'a',
  'mp4', 'mp3', 'avi', 'mov', 'mkv', 'wav', 'flac', 'ogg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'db', 'sqlite', 'bin', 'dat', 'dump',
  'ttf', 'woff', 'woff2', 'eot'
])

async function runConcurrent(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const current = nextIndex++
      await tasks[current]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function catSearchFile(fileUrl: string, query: string, revision?: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const { bin, env, authArgs } = getSvnSpawnContext()
    const target = buildHistoricalRemoteTarget(fileUrl, revision)
    const proc = spawn(bin, ['cat', ...target.revisionArgs, target.targetUrl, ...authArgs], { env })
    let buffer = ''
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM')
      finish(false)
    }, 30000)

    proc.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      buffer += chunk.toString('utf-8')
      if (buffer.toLowerCase().includes(query)) {
        clearTimeout(timeoutId)
        proc.kill('SIGTERM')
        finish(true)
        return
      }
      if (buffer.length > 512 * 1024) {
        buffer = buffer.slice(-(query.length + 16))
      }
    })
    proc.on('close', () => {
      clearTimeout(timeoutId)
      finish(false)
    })
    proc.on('error', () => {
      clearTimeout(timeoutId)
      finish(false)
    })
  })
}

export async function searchRemote(
  url: string,
  query: string,
  deepSearch: boolean,
  options: {
    maxResults?: number
    onProgress?: (progress: SearchProgress) => void
    onResult?: (result: RemoteSearchResult) => void
    revision?: number
  } = {}
): Promise<RemoteSearchResponse> {
  const target = buildHistoricalRemoteTarget(url, options.revision)
  const q = String(query || '').trim().toLowerCase()
  if (!q) return { results: [], searched: 0, total: 0, truncated: false }

  type SearchEntry = { path: string; name: string; kind: 'dir' | 'file'; entryUrl: string }
  const baseUrl = normalizeRepoUrl(target.safeUrl)
  const allEntries: SearchEntry[] = []
  const dirQueue: string[] = [baseUrl]
  let processedDirs = 0
  const listBatch = 5

  while (dirQueue.length > 0) {
    const batch = dirQueue.splice(0, listBatch)
    const stdouts = await Promise.all(batch.map(async (dirUrl) => {
      try {
        const dirTarget = buildHistoricalRemoteTarget(dirUrl, target.revision)
        const { stdout } = await runSvn(
          ['list', '--xml', ...dirTarget.revisionArgs, dirTarget.targetUrl],
          { timeoutMs: 30000 }
        )
        return { dirUrl, stdout }
      } catch {
        return { dirUrl, stdout: null }
      }
    }))
    processedDirs += batch.length

    for (const { dirUrl, stdout } of stdouts) {
      if (!stdout) continue
      const parsed = await parseXml(stdout)
      const rawList = parsed.lists?.list
      const listArr = Array.isArray(rawList) ? rawList : rawList ? [rawList] : []
      for (const list of listArr) {
        const listPath = normalizeRepoUrl(dirUrl)
        const entries = list.entry
        if (!entries) continue
        const arr = Array.isArray(entries) ? entries : [entries]
        for (const entry of arr) {
          const rawName = entry.name?._?.trim() || (typeof entry.name === 'string' ? entry.name : '') || ''
          const name = rawName.replace(/\/$/, '')
          if (!name) continue
          const kind: 'dir' | 'file' = entry.$?.kind === 'dir' ? 'dir' : 'file'
          const entryUrl = `${listPath}/${name}`
          const relativePath = entryUrl.replace(new RegExp(`^${escapeRegExp(baseUrl)}/?`), '')
          allEntries.push({ path: relativePath, name, kind, entryUrl })
          if (kind === 'dir') dirQueue.push(entryUrl)
        }
      }
    }

    options.onProgress?.({
      searched: 0,
      total: 0,
      listingStats: { dirs: processedDirs, entries: allEntries.length }
    })
  }

  const maxResults = Math.max(1, Math.min(500, options.maxResults ?? 200))
  const results: RemoteSearchResult[] = []
  let truncated = false
  const pushResult = (result: RemoteSearchResult) => {
    if (results.length < maxResults) {
      results.push(result)
      options.onResult?.(result)
      return
    }
    truncated = true
  }

  const nameResults = allEntries
    .filter((entry) => entry.name.toLowerCase().includes(q))
    .map((entry) => ({ ...entry, matchType: 'name' as const }))
  for (const result of nameResults) pushResult(result)

  try {
    const logArgs = ['log', '--xml', '--limit', '500']
    if (target.revision) logArgs.push('-r', `${target.revision}:1`)
    logArgs.push(target.targetUrl)
    const { stdout } = await runSvn(logArgs, { timeoutMs: 120000 })
    const entries = parseLogEntries(await parseXml(stdout))
    for (const entry of entries) {
      if (entry.message && entry.message.toLowerCase().includes(q)) {
        pushResult({
          path: entry.message.length > 90 ? `${entry.message.slice(0, 90)}...` : entry.message,
          name: `r${entry.revision}`,
          kind: 'revision',
          matchType: 'comment',
          entryUrl: baseUrl,
          revision: entry.revision,
          revisionMessage: entry.message
        })
      }
    }
  } catch {
    // continue with name/content results
  }

  if (!deepSearch) {
    return {
      results,
      searched: 0,
      total: 0,
      truncated
    }
  }

  const nameResultPaths = new Set(nameResults.map((result) => result.path))
  const fileEntries = allEntries.filter((entry) => (
    entry.kind === 'file'
    && !nameResultPaths.has(entry.path)
    && !BINARY_EXTENSIONS.has((entry.name.split('.').pop() || '').toLowerCase())
  ))
  let searched = 0
  const total = fileEntries.length
  options.onProgress?.({ searched: 0, total })

  await runConcurrent(fileEntries.map((entry) => async () => {
    const hasMatch = await catSearchFile(entry.entryUrl, q, target.revision)
    searched += 1
    if (hasMatch) pushResult({ ...entry, matchType: 'content' })
    options.onProgress?.({ searched, total })
  }), 8)

  return {
    results,
    searched,
    total,
    truncated
  }
}

export async function localStatus(repoPath: string): Promise<LocalStatusChange[]> {
  const { stdout } = await runSvn(['status', '--xml'], { cwd: repoPath })
  return buildStatusChangesFromParsed(await parseXml(stdout), repoPath)
}

export async function localDiff(repoPath: string, filePath: string): Promise<TextResult> {
  const { relativePath } = resolveRepoRelativeTarget(repoPath, filePath)
  try {
    const { stdout } = await runSvn(['diff', relativePath], { cwd: repoPath })
    return truncateText(stdout || '(sin cambios)')
  } catch {
    try {
      const { stdout } = await runSvn(['status', '--xml', relativePath], { cwd: repoPath })
      const parsed = await parseXml(stdout)
      const target = parsed.status?.target
      const entry = Array.isArray(target?.entry) ? target.entry[0] : target?.entry
      if (entry?.['wc-status']?.$?.item === 'unversioned') {
        return truncateText('(archivo sin versionar: SVN no genera diff hasta hacer add/commit)')
      }
    } catch {
      // ignore
    }
    return truncateText('(no se pudo obtener el diff)')
  }
}

export function localFileContent(repoPath: string, filePath: string): TextResult {
  const { targetAbs } = resolveRepoRelativeTarget(repoPath, filePath)
  if (!existsSync(targetAbs)) return truncateText('(archivo no encontrado)')
  if (!statSync(targetAbs).isFile()) return truncateText('(no es un archivo regular)')
  try {
    return truncateText(readFileSync(targetAbs, 'utf-8') || '(archivo vacío)')
  } catch {
    return truncateText('(no se pudo leer el contenido del archivo)')
  }
}

export async function localLog(repoPath: string, limit = 50, fromRevision?: number): Promise<any[]> {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50))
  const safeFromRevision = Number(fromRevision)
  const args = ['log', '--xml', '--verbose', `--limit=${safeLimit}`]
  if (Number.isFinite(safeFromRevision) && safeFromRevision > 0) {
    args.push('-r', `${Math.floor(safeFromRevision)}:1`)
  } else {
    args.push('-r', 'HEAD:1')
  }
  const { stdout } = await runSvn(args, { cwd: repoPath })
  return parseLogEntries(await parseXml(stdout))
}

export async function localBlame(repoPath: string, filePath: string): Promise<any[]> {
  const { targetAbs, relativePath } = resolveRepoRelativeTarget(repoPath, filePath)
  if (!existsSync(targetAbs)) throw new Error('El archivo no existe')
  if (!statSync(targetAbs).isFile()) throw new Error('Blame solo está disponible para archivos')

  const { stdout } = await runSvn(['blame', '--xml', relativePath], {
    cwd: repoPath,
    timeoutMs: 60000
  })
  const parsed = await parseXml(stdout)
  const entries = parsed.blame?.target?.entry
  const blameEntries = entries ? (Array.isArray(entries) ? entries : [entries]) : []
  const normalizedContent = readFileSync(targetAbs, 'utf-8').replace(/\r\n/g, '\n')
  const lines = normalizedContent.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) lines.push('')

  return lines.map((content, index) => {
    const commit = blameEntries[index]?.commit
    return {
      lineNum: index + 1,
      revision: Number.parseInt(commit?.$?.revision || '0', 10) || 0,
      author: String(commit?.author || ''),
      date: String(commit?.date || ''),
      content
    }
  })
}

export async function localRevisionFileDiff(
  repoPath: string,
  revision: number,
  svnPath: string
): Promise<TextResult> {
  const { stdout: infoXml } = await runSvn(['info', '--xml'], { cwd: repoPath })
  const parsed = await parseXml(infoXml)
  const rootUrl = parsed?.info?.entry?.repository?.root || ''
  if (!rootUrl) throw new Error('No se pudo obtener la URL raíz del repositorio')
  const fileUrl = rootUrl + svnPath
  try {
    const { stdout } = await runSvn(['diff', `-c${revision}`, '-x', '-U 9999', fileUrl])
    return truncateText(stdout || '(sin cambios en esta revisión)')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('was added') || message.includes('E195020')) {
      return truncateText(`(archivo añadido en r${revision})`)
    }
    throw error
  }
}

export async function svnInfo(path: string): Promise<any> {
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
}

export async function remoteLog(url: string, limit = 50, revision?: number): Promise<any[]> {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50))
  const target = buildHistoricalRemoteTarget(url, revision)
  const args = ['log', '--xml', '--verbose', `--limit=${safeLimit}`]
  if (target.revision) args.push('-r', `${target.revision}:1`)
  args.push(target.targetUrl)
  const { stdout } = await runSvn(args, { timeoutMs: 30000 })
  return parseLogEntries(await parseXml(stdout))
}

export async function remoteFileContent(url: string, revision?: number): Promise<TextResult> {
  const target = buildHistoricalRemoteTarget(url, revision)
  const { stdout } = await runSvn(['cat', ...target.revisionArgs, target.targetUrl])
  return truncateText(stdout)
}

export async function remoteRepoRoot(url: string, revision?: number): Promise<string | null> {
  const target = buildHistoricalRemoteTarget(url, revision)
  const { stdout } = await runSvn(['info', '--xml', ...target.revisionArgs, target.targetUrl])
  const parsed = await parseXml(stdout)
  return (parsed?.info?.entry?.repository?.root as string) || null
}

export async function remoteInfo(url: string, revision?: number): Promise<any> {
  const target = buildHistoricalRemoteTarget(url, revision)
  const { stdout } = await runSvn(['info', '--xml', ...target.revisionArgs, target.targetUrl])
  const parsed = await parseXml(stdout)
  const entry = parsed.info?.entry
  return {
    url: entry?.url || '',
    revision: parseInt(entry?.$?.revision || '0'),
    author: entry?.commit?.author || '',
    date: entry?.commit?.date || '',
    rootUrl: entry?.repository?.root || ''
  }
}

export async function remoteRevisionDiff(baseUrl: string, svnPath: string, revision: number): Promise<TextResult> {
  const { stdout: infoXml } = await runSvn(['info', '--xml', validateReadOnlyRemoteUrl(baseUrl)])
  const parsed = await parseXml(infoXml)
  const rootUrl = parsed?.info?.entry?.repository?.root || ''
  if (!rootUrl) throw new Error('No se pudo obtener la URL raíz del repositorio')
  const fileUrl = rootUrl + svnPath
  try {
    const { stdout } = await runSvn(['diff', `-c${revision}`, '-x', '-U 9999', fileUrl])
    return truncateText(stdout || '(sin cambios en esta revisión)')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('was added') || message.includes('E195020')) {
      return truncateText(`(archivo añadido en r${revision})`)
    }
    throw error
  }
}

export function resolveRemoteTarget(input: { remoteId?: string; url?: string }): string {
  if (input.remoteId) {
    const remote = ensureRemotesSeeded().find((candidate: StoredRemote) => candidate.id === input.remoteId)
    if (!remote) throw new Error('Repositorio remoto no encontrado')
    return remote.url
  }
  if (input.url) return validateReadOnlyRemoteUrl(input.url)
  throw new Error('Se requiere remoteId o url')
}
