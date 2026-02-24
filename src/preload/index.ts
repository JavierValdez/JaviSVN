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

  // Local repos
  listLocalRepos: () => ipcRenderer.invoke('repos:list'),
  getBasePath: () => ipcRenderer.invoke('repos:basePath'),

  // Remote SVN
  listRemote: (url: string) => ipcRenderer.invoke('svn:list', url),
  remoteLog: (url: string, limit?: number) => ipcRenderer.invoke('svn:remoteLog', url, limit),
  remoteMkdir: (parentUrl: string, name: string, message?: string) =>
    ipcRenderer.invoke('svn:remoteMkdir', parentUrl, name, message),
  remoteCreateFile: (parentUrl: string, name: string, content?: string, message?: string) =>
    ipcRenderer.invoke('svn:remoteCreateFile', parentUrl, name, content, message),
  ping: (url: string) => ipcRenderer.invoke('svn:ping', url),
  getVersion: () => ipcRenderer.invoke('svn:version'),
  getBinPath: () => ipcRenderer.invoke('svn:getBinPath'),
  setBinPath: (binPath: string) => ipcRenderer.invoke('svn:setBinPath', binPath),

  // Repo operations
  checkout: (url: string, targetName: string) =>
    ipcRenderer.invoke('svn:checkout', url, targetName),
  update: (repoPath: string) => ipcRenderer.invoke('svn:update', repoPath),
  status: (repoPath: string) => ipcRenderer.invoke('svn:status', repoPath),
  diff: (repoPath: string, filePath: string) => ipcRenderer.invoke('svn:diff', repoPath, filePath),
  commit: (repoPath: string, files: string[], message: string) =>
    ipcRenderer.invoke('svn:commit', repoPath, files, message),
  revert: (repoPath: string, files: string[]) =>
    ipcRenderer.invoke('svn:revert', repoPath, files),
  log: (repoPath: string, limit?: number) => ipcRenderer.invoke('svn:log', repoPath, limit),
  info: (path: string) => ipcRenderer.invoke('svn:info', path),

  // Dialog / shell
  openFile: (repoPath: string, filePath: string) =>
    ipcRenderer.invoke('dialog:openFile', repoPath, filePath),
  openFolder: (path: string) => ipcRenderer.invoke('dialog:openFolder', path),

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
