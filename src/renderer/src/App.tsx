import { useState, useEffect, useCallback } from 'react'
import { ActiveTab, Credentials, FileChange, LocalRepo, RemoteServer } from './types/svn'
import Sidebar from './components/Sidebar'
import ChangesView from './components/ChangesView'
import ExplorerView from './components/ExplorerView'
import HistoryView from './components/HistoryView'
import AuthDialog from './components/AuthDialog'

declare global {
  interface Window {
    svn: {
      getCredentials: () => Promise<Credentials | null>
      setCredentials: (c: { username: string; password: string; serverUrl: string }) => Promise<boolean>
      clearCredentials: () => Promise<boolean>
      getServerUrl: () => Promise<string>
      setServerUrl: (serverUrl: string) => Promise<boolean>
      listRemotes: () => Promise<RemoteServer[]>
      saveRemote: (remote: { name: string; url: string }) => Promise<RemoteServer>
      selectRemote: (remoteId: string) => Promise<RemoteServer>
      listLocalRepos: () => Promise<LocalRepo[]>
      getBasePath: () => Promise<string>
      listRemote: (url: string) => Promise<any[]>
      remoteLog: (url: string, limit?: number) => Promise<any[]>
      remoteMkdir: (parentUrl: string, name: string, message?: string) => Promise<any>
      remoteCreateFile: (parentUrl: string, name: string, content?: string, message?: string) => Promise<any>
      ping: (url: string) => Promise<{ ok: boolean; authError?: boolean; message?: string }>
      getVersion: () => Promise<{ version: string | null; bin: string }>
      getBinPath: () => Promise<{ bin: string; configured: string | null; version: string | null }>
      setBinPath: (binPath: string) => Promise<{ bin: string; version: string | null }>
      checkout: (url: string, targetName: string) => Promise<any>
      update: (repoPath: string) => Promise<any>
      status: (repoPath: string) => Promise<FileChange[]>
      diff: (repoPath: string, filePath: string) => Promise<string>
      commit: (repoPath: string, files: string[], message: string) => Promise<any>
      revert: (repoPath: string, files: string[]) => Promise<any>
      log: (repoPath: string, limit?: number) => Promise<any[]>
      info: (path: string) => Promise<any>
      openFile: (repoPath: string, filePath: string) => Promise<void>
      openFolder: (path: string) => Promise<void>
      installSvn: () => Promise<{ success: boolean; bin: string }>
      onCheckoutProgress: (cb: (msg: string) => void) => () => void
      onUpdateProgress: (cb: (msg: string) => void) => () => void
      onInstallProgress: (cb: (msg: string) => void) => () => void
    }
  }
}

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }
const DEFAULT_SERVER_URL = 'https://linrepo00.sat-interno.gob.gt/svn'

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [authInitialServerUrl, setAuthInitialServerUrl] = useState(DEFAULT_SERVER_URL)
  const [remoteServers, setRemoteServers] = useState<RemoteServer[]>([])
  const [activeRemoteId, setActiveRemoteId] = useState<string | null>(null)
  const [localRepos, setLocalRepos] = useState<LocalRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<LocalRepo | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('changes')
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loadingChanges, setLoadingChanges] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [showUpdateProgress, setShowUpdateProgress] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [svnVersion, setSvnVersion] = useState<string | null>(null)
  const [svnMissing, setSvnMissing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState('')

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now()
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  // Init
  useEffect(() => {
    const init = async () => {
      try {
        const serverUrl = await window.svn.getServerUrl()
        setAuthInitialServerUrl(serverUrl || DEFAULT_SERVER_URL)

        const remotes = await window.svn.listRemotes()
        setRemoteServers(remotes)
        setActiveRemoteId(remotes.find((r) => r.active)?.id || null)

        const creds = await window.svn.getCredentials()
        const validCreds = creds?.username ? creds : null
        setCredentials(validCreds)
        if (!validCreds) setShowAuthDialog(true)

        const repos = await window.svn.listLocalRepos()
        setLocalRepos(repos)
        if (repos.length > 0) setSelectedRepo(repos[0])

        const ver = await window.svn.getVersion()
        setSvnVersion(ver.version)
        if (ver.version === null) setSvnMissing(true)
      } catch (err: any) {
        console.error(err)
        toast('No se pudo inicializar la API de SVN. Abre la app desde Electron.', 'error')
      }
    }
    init()
  }, [toast])

  // Load changes when repo changes
  useEffect(() => {
    if (!selectedRepo) return
    loadChanges()
  }, [selectedRepo])

  const loadChanges = async () => {
    if (!selectedRepo) return
    setLoadingChanges(true)
    try {
      const ch = await window.svn.status(selectedRepo.path)
      setChanges(ch)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoadingChanges(false)
    }
  }

  const refreshRepos = async () => {
    const repos = await window.svn.listLocalRepos()
    setLocalRepos(repos)
    if (selectedRepo) {
      const updated = repos.find((r) => r.path === selectedRepo.path)
      if (updated) setSelectedRepo(updated)
    }
  }

  const refreshRemotes = async () => {
    const remotes = await window.svn.listRemotes()
    setRemoteServers(remotes)
    setActiveRemoteId(remotes.find((r) => r.active)?.id || null)
  }

  const handleUpdate = async () => {
    if (!selectedRepo) return
    setUpdating(true)
    setUpdateLog('')
    setShowUpdateProgress(true)

    const unsub = window.svn.onUpdateProgress((msg) => {
      setUpdateLog((prev) => prev + msg)
    })

    try {
      await window.svn.update(selectedRepo.path)
      toast('Repositorio actualizado correctamente', 'success')
      await loadChanges()
      await refreshRepos()
    } catch (err: any) {
      toast(err.message || 'Error al actualizar', 'error')
    } finally {
      unsub()
      setUpdating(false)
      setShowUpdateProgress(false)
    }
  }

  const handleSelectRepo = (repo: LocalRepo) => {
    setSelectedRepo(repo)
    setActiveTab('changes')
  }

  const handleAuthSave = async (creds: { username: string; password: string; serverUrl: string }) => {
    await window.svn.setCredentials(creds)
    setCredentials(creds as Credentials)
    setAuthInitialServerUrl(creds.serverUrl || DEFAULT_SERVER_URL)
    setShowAuthDialog(false)
    toast('Credenciales guardadas', 'success')
    await refreshRepos()
    await refreshRemotes()
  }

  const handleRequestCredentials = (serverUrl?: string) => {
    if (serverUrl?.trim()) setAuthInitialServerUrl(serverUrl.trim())
    setShowAuthDialog(true)
  }

  const openExplorer = () => {
    setActiveTab('explorer')
    if (!credentials) setShowAuthDialog(true)
  }

  const handleSaveRemote = async (name: string, url: string) => {
    const saved = await window.svn.saveRemote({ name, url })
    await refreshRemotes()
    setActiveRemoteId(saved.id)
    setAuthInitialServerUrl(saved.url)
    setActiveTab('explorer')
    toast(`Remoto "${saved.name}" guardado`, 'success')
  }

  const handleSelectRemote = async (remoteId: string) => {
    try {
      const selected = await window.svn.selectRemote(remoteId)
      await refreshRemotes()
      setActiveRemoteId(selected.id)
      setAuthInitialServerUrl(selected.url)
      setActiveTab('explorer')
      if (!credentials) setShowAuthDialog(true)
    } catch (err: any) {
      toast(err.message || 'No se pudo abrir el remoto', 'error')
    }
  }

  const handleInstallSvn = async () => {
    setInstalling(true)
    setInstallLog('')
    const unsub = window.svn.onInstallProgress((msg) => {
      setInstallLog((prev) => prev + msg)
    })
    try {
      const result = await window.svn.installSvn()
      if (result.success) {
        const ver = await window.svn.getVersion()
        setSvnVersion(ver.version)
        setSvnMissing(false)
        toast('SVN instalado correctamente', 'success')
      }
    } catch (err: any) {
      toast(err.message || 'Error al instalar SVN', 'error')
    } finally {
      unsub()
      setInstalling(false)
    }
  }

  const handleCheckoutDone = async () => {
    await refreshRepos()
    const repos = await window.svn.listLocalRepos()
    if (repos.length > 0 && !selectedRepo) {
      setSelectedRepo(repos[0])
    }
  }

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <span className="titlebar-title">JaviSVN</span>
        {svnVersion && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#768390' }}>
            SVN {svnVersion}
          </span>
        )}
      </div>

      <div className="app-body">
        {/* Sidebar */}
        <Sidebar
          repos={localRepos}
          remotes={remoteServers}
          selectedRepo={selectedRepo}
          isExplorerActive={activeTab === 'explorer'}
          activeRemoteId={activeRemoteId}
          onSelectRepo={handleSelectRepo}
          onSelectRemote={handleSelectRemote}
          onOpenExplorer={openExplorer}
          onRefresh={refreshRepos}
        />

        {/* Main area */}
        <div className="main">
          {activeTab === 'explorer' ? (
            <ExplorerView
              credentials={credentials}
              activeRemote={remoteServers.find((r) => r.id === activeRemoteId) || null}
              onSaveRemote={handleSaveRemote}
              onCheckoutDone={handleCheckoutDone}
              onRequestCredentials={handleRequestCredentials}
              toast={toast}
            />
          ) : selectedRepo ? (
            <>
              {/* Toolbar */}
              <div className="toolbar">
                <div className="toolbar-repo-name">{selectedRepo.name}</div>
                <div className="toolbar-branch">
                  <span>🌿</span>
                  <span>main (r{selectedRepo.revision})</span>
                </div>
                <button
                  className="btn btn-default"
                  onClick={() => window.svn.openFolder(selectedRepo.path)}
                >
                  📂 Abrir carpeta
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleUpdate}
                  disabled={updating}
                >
                  {updating ? '⟳ Actualizando...' : '⟳ Actualizar'}
                </button>
              </div>

              {/* Tab bar */}
              <div className="tabbar">
                <div
                  className={`tab ${activeTab === 'changes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('changes')}
                >
                  Cambios
                  {changes.length > 0 && (
                    <span className="tab-badge">{changes.length}</span>
                  )}
                </div>
                <div
                  className={`tab ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  Historial
                </div>
              </div>

              {/* Content */}
              {activeTab === 'changes' && (
                <ChangesView
                  repo={selectedRepo}
                  changes={changes}
                  loading={loadingChanges}
                  onRefresh={loadChanges}
                  toast={toast}
                />
              )}
              {activeTab === 'history' && (
                <HistoryView repo={selectedRepo} toast={toast} />
              )}
            </>
          ) : (
            <div className="welcome">
              <div className="empty-state">
                <div className="empty-state-icon">📦</div>
                <div className="empty-state-title">No hay repositorios locales</div>
                <div className="empty-state-sub">
                  Usa el Explorador SVN para descargar repositorios del servidor
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={openExplorer}
                >
                  Explorar repositorios
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Auth Dialog */}
      {showAuthDialog && (
        <AuthDialog
          onSave={handleAuthSave}
          onCancel={() => setShowAuthDialog(false)}
          initialServerUrl={authInitialServerUrl}
        />
      )}

      {/* Update progress */}
      {showUpdateProgress && (
        <div className="progress-overlay">
          <div className="progress-box">
            <div className="progress-title">⟳ Actualizando repositorio...</div>
            <div className="progress-log">{updateLog}</div>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}

      {/* SVN not found — auto install dialog */}
      {svnMissing && (
        <div className="progress-overlay">
          <div className="progress-box" style={{ maxWidth: 480 }}>
            <div className="progress-title" style={{ fontSize: 15, marginBottom: 8 }}>
              SVN no encontrado
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 16px' }}>
              SVN no está instalado en este sistema. JaviSVN lo puede instalar
              automáticamente usando Homebrew.
            </p>
            {installing ? (
              <>
                <div className="progress-log" style={{ minHeight: 120 }}>{installLog || 'Iniciando instalacion...'}</div>
                <div className="progress-bar-wrap" style={{ marginTop: 12 }}>
                  <div className="progress-bar" style={{ width: '100%', animation: 'progress-indeterminate 1.5s ease-in-out infinite' }} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
                  Esto puede tardar unos minutos...
                </p>
              </>
            ) : (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleInstallSvn}>
                Instalar SVN automaticamente
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
