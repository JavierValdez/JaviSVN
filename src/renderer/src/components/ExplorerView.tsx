import { useState, useEffect } from 'react'
import { Credentials, LogEntry, RemoteEntry, RemoteServer } from '../types/svn'

interface Props {
  credentials: Credentials | null
  activeRemote: RemoteServer | null
  onSaveRemote: (name: string, url: string) => Promise<void>
  onCheckoutDone: () => void
  onRequestCredentials: (serverUrl?: string) => void
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

interface CheckoutState {
  url: string
  name: string
  running: boolean
  log: string
  done: boolean
}

interface RemoteLogState {
  open: boolean
  url: string
  title: string
  loading: boolean
  entries: LogEntry[]
  selected: LogEntry | null
}

interface CreateRemoteState {
  type: 'folder' | 'file'
  parentUrl: string
  parentName: string
  name: string
  message: string
  content: string
  running: boolean
}

const ACTION_LABEL: Record<string, string> = {
  M: '✏️',
  A: '➕',
  D: '🗑️',
  R: '🔄'
}

function getSvnApi(): any {
  const api = (window as any).svn
  if (!api) {
    throw new Error('No se encontró la API de Electron (window.svn). Ejecuta la app con `npm run dev`.')
  }
  return api
}

function normalizeError(err: any): string {
  const raw = String(err?.message || err || 'Error desconocido')
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim()
}

function isLegacySslError(message: string | null): boolean {
  if (!message) return false
  return /E120171|SSL communication/i.test(message)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('es-GT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function suggestRemoteName(url: string): string {
  const safeUrl = (url || '').trim()
  if (!safeUrl) return 'Servidor SVN'
  try {
    const parsed = new URL(safeUrl)
    const host = parsed.hostname || 'servidor'
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const tail = pathParts.slice(-2).join('/')
    return tail ? `${host}/${tail}` : host
  } catch {
    const raw = safeUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    const parts = raw.split('/').filter(Boolean)
    return parts.slice(-2).join('/') || raw || 'Servidor SVN'
  }
}

export default function ExplorerView({
  credentials,
  activeRemote,
  onSaveRemote,
  onCheckoutDone,
  onRequestCredentials,
  toast
}: Props) {
  const [serverUrl, setServerUrl] = useState('')
  const [tree, setTree] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set())
  const [childrenCache, setChildrenCache] = useState<Record<string, RemoteEntry[]>>({})
  const [loadingChildrenUrls, setLoadingChildrenUrls] = useState<Set<string>>(new Set())
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)
  const [remoteLog, setRemoteLog] = useState<RemoteLogState>({
    open: false,
    url: '',
    title: '',
    loading: false,
    entries: [],
    selected: null
  })
  const [createRemote, setCreateRemote] = useState<CreateRemoteState | null>(null)

  const configureSvnBinary = async () => {
    try {
      const svn = getSvnApi()
      const info = await svn.getBinPath()
      const current = info.configured || info.bin
      const answer = window.prompt(
        'Ruta del binario SVN legacy (deja vacío o escribe "auto" para detección automática):',
        current
      )
      if (answer === null) return

      const target = answer.trim() || 'auto'
      const result = await svn.setBinPath(target)
      const versionInfo = result.version ? ` (SVN ${result.version})` : ''
      toast(`Cliente SVN activo: ${result.bin}${versionInfo}`, 'success')
      setError(null)
    } catch (err: any) {
      toast(normalizeError(err) || 'No se pudo configurar el binario SVN', 'error')
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const svn = getSvnApi()
        const url = activeRemote?.url || await svn.getServerUrl()
        if (url) setServerUrl(url)
      } catch (err: any) {
        setError(err.message || 'No se pudo inicializar el Explorador SVN')
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (!activeRemote?.url) return
    setServerUrl(activeRemote.url)
    setTree([])
    setExpandedUrls(new Set())
    setChildrenCache({})
    setLoadingChildrenUrls(new Set())
    setError(null)
  }, [activeRemote?.id])

  const saveServerUrl = async (): Promise<boolean> => {
    const nextUrl = serverUrl.trim()
    if (!nextUrl) {
      toast('Ingresa una URL de servidor SVN válida', 'error')
      return false
    }

    const normalized = nextUrl.replace(/\/$/, '')
    const activeNormalized = (activeRemote?.url || '').replace(/\/$/, '')
    const defaultName =
      activeRemote && activeNormalized === normalized
        ? activeRemote.name
        : suggestRemoteName(nextUrl)
    const nameInput = window.prompt('Nombre para este repositorio remoto:', defaultName)
    if (nameInput === null) return false

    const remoteName = nameInput.trim()
    if (!remoteName) {
      toast('El nombre del repositorio remoto es requerido', 'error')
      return false
    }

    try {
      await onSaveRemote(remoteName, nextUrl)
      setServerUrl(nextUrl)
      return true
    } catch (err: any) {
      toast(normalizeError(err) || 'No se pudo guardar la URL del servidor', 'error')
      return false
    }
  }

  const loadRoot = async () => {
    const nextUrl = serverUrl.trim()
    if (!nextUrl) {
      toast('Ingresa una URL de servidor SVN', 'error')
      return
    }

    if (!credentials) {
      onRequestCredentials(nextUrl)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const svn = getSvnApi()
      await svn.setServerUrl(nextUrl)
      const entries = await svn.listRemote(nextUrl)
      setTree(entries)
      setExpandedUrls(new Set())
      setChildrenCache({})
      setLoadingChildrenUrls(new Set())
    } catch (err: any) {
      setError(normalizeError(err) || 'Error al conectar con el servidor SVN')
    } finally {
      setLoading(false)
    }
  }

  const refreshChildren = async (parentUrl: string) => {
    const key = parentUrl
    setLoadingChildrenUrls((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setExpandedUrls((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })

    try {
      const svn = getSvnApi()
      const children = await svn.listRemote(parentUrl)
      setChildrenCache((prev) => ({ ...prev, [key]: children }))
    } finally {
      setLoadingChildrenUrls((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const toggleExpand = async (entry: RemoteEntry) => {
    if (entry.kind !== 'dir') return

    const key = entry.url
    const isExpanded = expandedUrls.has(key)
    const isLoadingChildren = loadingChildrenUrls.has(key)

    if (isLoadingChildren) return

    if (isExpanded) {
      setExpandedUrls((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      return
    }

    setExpandedUrls((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })

    // Load children if not cached
    if (!(key in childrenCache)) {
      setLoadingChildrenUrls((prev) => {
        const next = new Set(prev)
        next.add(key)
        return next
      })

      try {
        const svn = getSvnApi()
        const children = await svn.listRemote(entry.url)
        setChildrenCache((prev) => ({ ...prev, [key]: children }))
      } catch (err: any) {
        toast('Error al cargar contenido: ' + normalizeError(err), 'error')
        setExpandedUrls((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      } finally {
        setLoadingChildrenUrls((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    }
  }

  const startCheckout = (entry: RemoteEntry) => {
    const nameParts = entry.url.split('/')
    const defaultName = nameParts[nameParts.length - 1].replace(/\/$/, '') || 'repo'
    setCheckout({
      url: entry.url,
      name: defaultName,
      running: false,
      log: '',
      done: false
    })
  }

  const doCheckout = async () => {
    if (!checkout) return
    if (!checkout.name.trim()) {
      toast('Escribe un nombre para el directorio local', 'error')
      return
    }

    setCheckout((prev) => prev ? { ...prev, running: true, log: '' } : null)

    let unsub = () => {}

    try {
      const svn = getSvnApi()
      unsub = svn.onCheckoutProgress((msg: string) => {
        setCheckout((prev) => prev ? { ...prev, log: prev.log + msg } : null)
      })
      await svn.checkout(checkout.url, checkout.name.trim())
      setCheckout((prev) => prev ? { ...prev, running: false, done: true } : null)
      toast('Repositorio descargado correctamente', 'success')
      onCheckoutDone()
      // Refresh tree to show updated isCheckedOut status
      setTimeout(() => {
        loadRoot()
        setCheckout(null)
      }, 1500)
    } catch (err: any) {
      setCheckout((prev) => prev ? { ...prev, running: false } : null)
      toast(normalizeError(err) || 'Error al descargar el repositorio', 'error')
    } finally {
      unsub()
    }
  }

  const openRemoteLog = async (entry: RemoteEntry) => {
    const title = entry.name.replace(/\/$/, '') || entry.url
    setRemoteLog({
      open: true,
      url: entry.url,
      title,
      loading: true,
      entries: [],
      selected: null
    })

    try {
      const svn = getSvnApi()
      const entries = await svn.remoteLog(entry.url, 100)
      setRemoteLog((prev) => ({
        ...prev,
        loading: false,
        entries,
        selected: entries.length > 0 ? entries[0] : null
      }))
    } catch (err: any) {
      setRemoteLog((prev) => ({ ...prev, loading: false }))
      toast(normalizeError(err) || 'Error al cargar log remoto', 'error')
    }
  }

  const openCreateRemoteDialog = (type: 'folder' | 'file', parent: RemoteEntry) => {
    setCreateRemote({
      type,
      parentUrl: parent.url,
      parentName: parent.name.replace(/\/$/, ''),
      name: '',
      message: '',
      content: '',
      running: false
    })
  }

  const submitCreateRemote = async () => {
    if (!createRemote) return
    const name = createRemote.name.trim()
    if (!name) {
      toast('Escribe un nombre', 'error')
      return
    }

    setCreateRemote((prev) => (prev ? { ...prev, running: true } : null))
    try {
      const svn = getSvnApi()
      if (createRemote.type === 'folder') {
        await svn.remoteMkdir(createRemote.parentUrl, name, createRemote.message.trim() || undefined)
        toast('Carpeta creada correctamente', 'success')
      } else {
        await svn.remoteCreateFile(
          createRemote.parentUrl,
          name,
          createRemote.content,
          createRemote.message.trim() || undefined
        )
        toast('Archivo creado correctamente', 'success')
      }

      const parentExistsInRoot = tree.some((x) => x.url === createRemote.parentUrl)
      if (parentExistsInRoot) {
        await loadRoot()
      } else {
        await refreshChildren(createRemote.parentUrl)
      }
      setCreateRemote(null)
    } catch (err: any) {
      setCreateRemote((prev) => (prev ? { ...prev, running: false } : null))
      toast(normalizeError(err) || 'Error al crear elemento remoto', 'error')
    }
  }

  const renderEntry = (entry: RemoteEntry, depth = 0) => {
    const isDir = entry.kind === 'dir'
    const isExpanded = expandedUrls.has(entry.url)
    const children = childrenCache[entry.url]
    const isLoadingChildren = loadingChildrenUrls.has(entry.url)
    const hasLoadedChildren = Object.prototype.hasOwnProperty.call(childrenCache, entry.url)

    return (
      <div key={entry.url}>
        <div
          className={`tree-item ${isExpanded ? 'expanded' : ''} ${isLoadingChildren ? 'loading' : ''}`}
          style={{ paddingLeft: 16 + depth * 20 }}
        >
          {/* Expand arrow */}
          {isDir ? (
            <span
              className={`expand-icon ${isExpanded ? 'expanded' : ''} ${isLoadingChildren ? 'loading' : ''}`}
              onClick={() => toggleExpand(entry)}
              style={{ cursor: isLoadingChildren ? 'wait' : 'pointer' }}
            >
              {isLoadingChildren ? (
                <span className="spinner tree-expand-spinner" />
              ) : (
                <svg className="tree-chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          ) : (
            <span className="expand-icon placeholder" />
          )}

          {/* Icon */}
          <span
            className="tree-item-icon"
            onClick={() => toggleExpand(entry)}
            style={{ cursor: isDir ? (isLoadingChildren ? 'wait' : 'pointer') : 'default' }}
          >
            {isDir ? (isExpanded ? '📂' : '📁') : getFileIcon(entry.name)}
          </span>

          {/* Name */}
          <span
            className="tree-item-name"
            onClick={() => toggleExpand(entry)}
            style={{ cursor: isDir ? (isLoadingChildren ? 'wait' : 'pointer') : 'default' }}
          >
            {entry.name.replace(/\/$/, '')}
          </span>

          {/* Meta */}
          <span className="tree-item-meta">r{entry.revision}</span>

          {/* Checked out badge */}
          {entry.isCheckedOut && (
            <span className="tree-item-checked">✓ Local</span>
          )}

          <div className="tree-actions">
            <button
              className="btn btn-ghost tree-action-btn"
              title="Ver log"
              onClick={(e) => {
                e.stopPropagation()
                openRemoteLog(entry)
              }}
            >
              🕘 Log
            </button>
            {isDir && (
              <>
                <button
                  className="btn btn-ghost tree-action-btn"
                  title="Crear subcarpeta"
                  onClick={(e) => {
                    e.stopPropagation()
                    openCreateRemoteDialog('folder', entry)
                  }}
                >
                  📁+ Carpeta
                </button>
                <button
                  className="btn btn-ghost tree-action-btn"
                  title="Crear archivo"
                  onClick={(e) => {
                    e.stopPropagation()
                    openCreateRemoteDialog('file', entry)
                  }}
                >
                  📄+ Archivo
                </button>
              </>
            )}
          </div>

          {/* Checkout button */}
          {isDir && (
            <button
              className="btn btn-primary"
              style={{ padding: '3px 10px', fontSize: 11, marginLeft: 8 }}
              onClick={(e) => { e.stopPropagation(); startCheckout(entry) }}
            >
              {entry.isCheckedOut ? '↻ Re-descargar' : '⬇ Descargar'}
            </button>
          )}
        </div>

        {/* Children */}
        {isExpanded && (isLoadingChildren || hasLoadedChildren) && (
          <div className="tree-children">
            {isLoadingChildren ? (
              <div className="tree-loading-row">
                <div className="spinner tree-loading-spinner" />
                <span>Cargando contenido...</span>
              </div>
            ) : children.length === 0 ? (
              <div style={{ padding: '4px 16px', fontSize: 12, color: 'var(--text3)' }}>
                (directorio vacío)
              </div>
            ) : (
              children.map((child) => renderEntry(child, depth + 1))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="explorer-layout">
      {/* Toolbar */}
      <div className="explorer-toolbar">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>🌐 Servidor SVN</span>
        <input
          className="form-input explorer-url-input"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://servidor/svn"
          title="URL del servidor SVN"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              loadRoot()
            }
          }}
        />
        <button className="btn btn-default" onClick={saveServerUrl} disabled={loading}>
          Guardar URL
        </button>
        <button className="btn btn-default" onClick={configureSvnBinary} disabled={loading}>
          Cliente SVN
        </button>
        {!credentials ? (
          <button
            className="btn btn-ghost"
            style={{ color: 'var(--danger)' }}
            onClick={() => onRequestCredentials(serverUrl)}
          >
            ⚠️ Sin credenciales
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--success)', flexShrink: 0 }}>
            👤 {credentials.username}
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={loadRoot}
          disabled={loading}
        >
          {loading ? '⟳ Cargando...' : '⟳ Conectar'}
        </button>
      </div>

      {/* Tree */}
      <div className="explorer-tree">
        {loading && tree.length === 0 ? (
          <div className="empty-state">
            <div className="spinner spinner-lg" />
            <div className="empty-state-sub">Conectando al servidor SVN...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <div className="empty-state-title">Error de conexión</div>
            <div className="empty-state-sub" style={{ color: 'var(--danger)' }}>{error}</div>
            <div className="empty-state-sub" style={{ marginTop: 8 }}>
              Verifica que estés en la red interna y que las credenciales sean correctas
            </div>
            {isLegacySslError(error) && (
              <>
                <div className="empty-state-sub" style={{ marginTop: 8, color: 'var(--warning)' }}>
                  El servidor parece usar SSL/TLS antiguo. Configura un cliente SVN legacy.
                </div>
                <button className="btn btn-default" style={{ marginTop: 10 }} onClick={configureSvnBinary}>
                  Configurar cliente SVN legacy
                </button>
              </>
            )}
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={loadRoot}>
              Reintentar
            </button>
          </div>
        ) : tree.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <div className="empty-state-title">Explorar repositorios SVN</div>
            <div className="empty-state-sub">
              Conéctate al servidor para ver los repositorios disponibles
            </div>
            {!credentials && (
              <button
                className="btn btn-default"
                style={{ marginTop: 8 }}
                onClick={() => onRequestCredentials(serverUrl)}
              >
                Configurar credenciales
              </button>
            )}
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={loadRoot}>
              Conectar al servidor
            </button>
          </div>
        ) : (
          tree.map((entry) => renderEntry(entry, 0))
        )}
      </div>

      {/* Remote log dialog */}
      {remoteLog.open && (
        <div className="overlay">
          <div className="dialog" style={{ width: 980, maxWidth: '92vw' }}>
            <div className="dialog-title">🕘 Historial remoto</div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {remoteLog.title} · {remoteLog.url}
            </div>

            <div
              className="history-layout"
              style={{ height: 460, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
            >
              <div className="history-list">
                {remoteLog.loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <div className="spinner spinner-lg" />
                  </div>
                ) : remoteLog.entries.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">Sin historial</div>
                  </div>
                ) : (
                  remoteLog.entries.map((entry) => (
                    <div
                      key={entry.revision}
                      className={`history-item ${remoteLog.selected?.revision === entry.revision ? 'selected' : ''}`}
                      onClick={() => setRemoteLog((prev) => ({ ...prev, selected: entry }))}
                    >
                      <div className="history-rev">r{entry.revision}</div>
                      <div className="history-msg">{entry.message || '(sin mensaje)'}</div>
                      <div className="history-meta">
                        {entry.author} · {formatDate(entry.date)}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="history-detail">
                {remoteLog.selected ? (
                  <>
                    <div className="history-detail-rev">Revisión {remoteLog.selected.revision}</div>
                    <div className="history-detail-author">
                      👤 {remoteLog.selected.author} · 🕐 {formatDate(remoteLog.selected.date)}
                    </div>
                    <div className="history-detail-msg">
                      {remoteLog.selected.message || '(sin mensaje de commit)'}
                    </div>

                    {remoteLog.selected.paths.length > 0 && (
                      <>
                        <div className="history-paths-title">
                          Cambios ({remoteLog.selected.paths.length})
                        </div>
                        {remoteLog.selected.paths.map((p, i) => (
                          <div key={i} className="history-path-item">
                            <span title={p.action}>{ACTION_LABEL[p.action] || p.action}</span>
                            <span>{p.path}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">Selecciona una revisión</div>
                  </div>
                )}
              </div>
            </div>

            <div className="dialog-actions">
              <button
                className="btn btn-default"
                onClick={() =>
                  setRemoteLog({ open: false, url: '', title: '', loading: false, entries: [], selected: null })
                }
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create remote dialog */}
      {createRemote && (
        <div className="overlay">
          <div className="dialog" style={{ width: 520 }}>
            <div className="dialog-title">
              {createRemote.type === 'folder' ? '📁 Crear subcarpeta' : '📄 Crear archivo'}
            </div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              Dentro de: {createRemote.parentUrl}
            </div>

            <div className="form-field">
              <label className="form-label">Nombre</label>
              <input
                className="form-input"
                value={createRemote.name}
                onChange={(e) => setCreateRemote((prev) => (prev ? { ...prev, name: e.target.value } : null))}
                placeholder={createRemote.type === 'folder' ? 'nueva-carpeta' : 'archivo.txt'}
                autoFocus
              />
            </div>

            {createRemote.type === 'file' && (
              <div className="form-field">
                <label className="form-label">Contenido inicial (opcional)</label>
                <textarea
                  className="form-input"
                  value={createRemote.content}
                  onChange={(e) => setCreateRemote((prev) => (prev ? { ...prev, content: e.target.value } : null))}
                  rows={6}
                  placeholder="Contenido del archivo..."
                  style={{ resize: 'vertical', fontFamily: 'SF Mono, Menlo, monospace' }}
                />
              </div>
            )}

            <div className="form-field">
              <label className="form-label">Mensaje de commit (opcional)</label>
              <input
                className="form-input"
                value={createRemote.message}
                onChange={(e) => setCreateRemote((prev) => (prev ? { ...prev, message: e.target.value } : null))}
                placeholder={createRemote.type === 'folder' ? 'Crear carpeta...' : 'Crear archivo...'}
              />
            </div>

            <div className="dialog-actions">
              <button
                className="btn btn-default"
                onClick={() => setCreateRemote(null)}
                disabled={createRemote.running}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={submitCreateRemote}
                disabled={createRemote.running || !createRemote.name.trim()}
              >
                {createRemote.running ? '⟳ Creando...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout dialog */}
      {checkout && (
        <div className="overlay">
          <div className="dialog" style={{ width: 460 }}>
            <div className="dialog-title">
              {checkout.done ? '✅ Descarga completada' : '⬇ Descargar repositorio'}
            </div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {checkout.url}
            </div>

            {!checkout.running && !checkout.done && (
              <div className="form-field">
                <label className="form-label">Nombre del directorio local</label>
                <input
                  className="form-input"
                  value={checkout.name}
                  onChange={(e) => setCheckout((prev) => prev ? { ...prev, name: e.target.value } : null)}
                  placeholder="nombre-del-repositorio"
                  autoFocus
                />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  Se creará en ~/Documents/JaviSvn/{checkout.name}
                </div>
              </div>
            )}

            {(checkout.running || checkout.done) && (
              <div className="progress-log" style={{ marginBottom: 12, height: 120 }}>
                {checkout.log || 'Iniciando descarga...'}
              </div>
            )}

            {checkout.running && (
              <div className="progress-bar-wrap">
                <div className="progress-bar" />
              </div>
            )}

            <div className="dialog-actions">
              <button
                className="btn btn-default"
                onClick={() => setCheckout(null)}
                disabled={checkout.running}
              >
                {checkout.done ? 'Cerrar' : 'Cancelar'}
              </button>
              {!checkout.done && (
                <button
                  className="btn btn-primary"
                  onClick={doCheckout}
                  disabled={checkout.running}
                >
                  {checkout.running ? '⟳ Descargando...' : '⬇ Descargar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    java: '☕',
    xml: '📋',
    json: '{}',
    html: '🌐',
    css: '🎨',
    js: '📜',
    ts: '📘',
    sql: '🗃️',
    txt: '📄',
    md: '📝',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    pdf: '📕',
    zip: '📦',
    jar: '📦',
    war: '📦',
    sh: '⚙️',
    bat: '⚙️',
    properties: '⚙️',
    yml: '⚙️',
    yaml: '⚙️'
  }
  return icons[ext || ''] || '📄'
}
