import { contextBridge, ipcRenderer } from 'electron'

const svnAPI = {
  // Credentials
  getCredentials: () => ipcRenderer.invoke('creds:get'),
  setCredentials: (creds: { username: string; password: string; serverUrl: string }) =>
    ipcRenderer.invoke('creds:set', creds),
  clearCredentials: () => ipcRenderer.invoke('creds:clear'),
  getServerUrl: () => ipcRenderer.invoke('creds:getServerUrl'),
  setServerUrl: (serverUrl: string) => ipcRenderer.invoke('creds:setServerUrl', serverUrl),
  listRemotes: () => ipcRenderer.invoke('remotes:list'),
  saveRemote: (remote: { name: string; url: string }) => ipcRenderer.invoke('remotes:save', remote),
  selectRemote: (remoteId: string) => ipcRenderer.invoke('remotes:select', remoteId),
  deleteRemote: (remoteId: string) => ipcRenderer.invoke('remotes:delete', remoteId),
  renameRemote: (remoteId: string, name: string, url?: string) => ipcRenderer.invoke('remotes:rename', remoteId, name, url),

  // Local repos
  listLocalRepos: () => ipcRenderer.invoke('repos:list'),
  getBasePath: () => ipcRenderer.invoke('repos:basePath'),
  deleteRepo: (repoPath: string) => ipcRenderer.invoke('repos:delete', repoPath),

  // Remote SVN
  listRemote: (url: string) => ipcRenderer.invoke('svn:list', url),
  searchRemote: (url: string, query: string, deepSearch: boolean) =>
    ipcRenderer.invoke('svn:searchRemote', url, query, deepSearch),
  remoteLog: (url: string, limit?: number) => ipcRenderer.invoke('svn:remoteLog', url, limit),
  remoteFileContent: (url: string) => ipcRenderer.invoke('svn:cat', url),
  getRepoRoot: (url: string) => ipcRenderer.invoke('svn:getRepoRoot', url),
  remoteRevisionDiff: (baseUrl: string, svnPath: string, revision: number) =>
    ipcRenderer.invoke('svn:remoteRevisionDiff', baseUrl, svnPath, revision),
  remoteMkdir: (parentUrl: string, name: string, message?: string) =>
    ipcRenderer.invoke('svn:remoteMkdir', parentUrl, name, message),
  remoteCreateFile: (parentUrl: string, name: string, content?: string, message?: string) =>
    ipcRenderer.invoke('svn:remoteCreateFile', parentUrl, name, content, message),
  svnExport: (url: string, targetPath: string) => ipcRenderer.invoke('svn:export', url, targetPath),
  pickExportFolder: () => ipcRenderer.invoke('dialog:pickExportFolder'),
  ping: (url: string) => ipcRenderer.invoke('svn:ping', url),
  pingWithCreds: (creds: { url: string; username: string; password: string }) =>
    ipcRenderer.invoke('svn:pingWithCreds', creds),
  getVersion: () => ipcRenderer.invoke('svn:version'),
  getBinPath: () => ipcRenderer.invoke('svn:getBinPath'),
  setBinPath: (binPath: string) => ipcRenderer.invoke('svn:setBinPath', binPath),

  // Repo operations
  checkout: (url: string, targetName: string) =>
    ipcRenderer.invoke('svn:checkout', url, targetName),
  update: (repoPath: string) => ipcRenderer.invoke('svn:update', repoPath),
  status: (repoPath: string) => ipcRenderer.invoke('svn:status', repoPath),
  diff: (repoPath: string, filePath: string) => ipcRenderer.invoke('svn:diff', repoPath, filePath),
  revisionFileDiff: (repoPath: string, revision: number, svnPath: string) =>
    ipcRenderer.invoke('svn:revisionFileDiff', repoPath, revision, svnPath),
  commit: (repoPath: string, files: string[], message: string) =>
    ipcRenderer.invoke('svn:commit', repoPath, files, message),
  revert: (repoPath: string, files: string[]) =>
    ipcRenderer.invoke('svn:revert', repoPath, files),
  log: (repoPath: string, limit?: number, fromRevision?: number) =>
    ipcRenderer.invoke('svn:log', repoPath, limit, fromRevision),
  info: (path: string) => ipcRenderer.invoke('svn:info', path),

  // Dialog / shell
  openFile: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('dialog:openFile', repoPath, filePath),
  openFolder: (path: string) => ipcRenderer.invoke('dialog:openFolder', path),
  listEditors: () => ipcRenderer.invoke('dialog:listEditors'),
  openInEditor: (editorId: string, repoPath: string) =>
    ipcRenderer.invoke('dialog:openInEditor', editorId, repoPath),

  // Install SVN via Homebrew (fallback when no bundled binary)
  installSvn: () => ipcRenderer.invoke('svn:install'),

  // Event listeners
  onCheckoutProgress: (cb: (msg: string) => void) => {
    const handler = (_: any, msg: string) => cb(msg)
    ipcRenderer.on('svn:checkout-progress', handler)
    return () => ipcRenderer.removeListener('svn:checkout-progress', handler)
  },
  onUpdateProgress: (cb: (msg: string) => void) => {
    const handler = (_: any, msg: string) => cb(msg)
    ipcRenderer.on('svn:update-progress', handler)
    return () => ipcRenderer.removeListener('svn:update-progress', handler)
  },
  onInstallProgress: (cb: (msg: string) => void) => {
    const handler = (_: any, msg: string) => cb(msg)
    ipcRenderer.on('svn:install-progress', handler)
    return () => ipcRenderer.removeListener('svn:install-progress', handler)
  },
  onSearchResult: (cb: (result: any) => void) => {
    const handler = (_: any, result: any) => cb(result)
    ipcRenderer.on('svn:searchResult', handler)
    return () => ipcRenderer.removeListener('svn:searchResult', handler)
  },
  onSearchProgress: (cb: (data: { searched: number; total: number }) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('svn:searchProgress', handler)
    return () => ipcRenderer.removeListener('svn:searchProgress', handler)
  },
  onSearchDone: (cb: (data: { searched: number; total: number }) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('svn:searchDone', handler)
    return () => ipcRenderer.removeListener('svn:searchDone', handler)
  },
  onExportProgress: (cb: (msg: string) => void) => {
    const handler = (_: any, msg: string) => cb(msg)
    ipcRenderer.on('svn:export-progress', handler)
    return () => ipcRenderer.removeListener('svn:export-progress', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('svn', svnAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as any).svn = svnAPI
}
