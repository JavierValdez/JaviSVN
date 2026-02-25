import { useState, useEffect, useRef } from 'react'
import { Credentials, LogEntry, RemoteEntry, RemoteSearchResult, RemoteServer } from '../types/svn'
import DiffViewer from './DiffViewer'

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

interface ExportState {
  url: string
  targetDir: string
  name: string
  running: boolean
  log: string
  done: boolean
  resultPath: string
}

interface RemoteLogState {
  open: boolean
  url: string
  title: string
  loading: boolean
  entries: LogEntry[]
  selected: LogEntry | null
  repoRoot: string | null
}

interface RemoteSearchDialogState {
  open: boolean
  url: string
  folderName: string
  query: string
  deepSearch: boolean
  running: boolean
  results: RemoteSearchResult[]
  searched: boolean
  error: string | null
  searchProgress: { searched: number; total: number; listingStats?: { dirs: number; entries: number } } | null
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

interface FileViewerState {
  open: boolean
  url: string
  name: string
  content: string | null
  loading: boolean
  error: string | null
}

interface RemoteFileDiffState {
  svnPath: string
  fileName: string
  diff: string | null
  loading: boolean
}

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
  'pdf', 'zip', 'jar', 'war', 'tar', 'gz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib', 'class',
  'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac'
])

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

function formatDateShort(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'hoy'
    if (diffDays === 1) return 'ayer'
    if (diffDays < 365) return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })
    return d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}


function highlightText(text: string, query: string) {
  if (!query.trim()) return text
  const q = query.trim()
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="tree-search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
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
  const [searchDialog, setSearchDialog] = useState<RemoteSearchDialogState>({
    open: false,
    url: '',
    folderName: '',
    query: '',
    deepSearch: false,
    running: false,
    results: [],
    searched: false,
    error: null,
    searchProgress: null
  })
  const searchUnsubsRef = useRef<Array<() => void>>([])
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set())
  const [childrenCache, setChildrenCache] = useState<Record<string, RemoteEntry[]>>({})
  const [loadingChildrenUrls, setLoadingChildrenUrls] = useState<Set<string>>(new Set())
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)
  const [svnExportDialog, setSvnExportDialog] = useState<ExportState | null>(null)
  const [remoteLog, setRemoteLog] = useState<RemoteLogState>({
    open: false,
    url: '',
    title: '',
    loading: false,
    entries: [],
    selected: null,
    repoRoot: null
  })
  const [createRemote, setCreateRemote] = useState<CreateRemoteState | null>(null)
  const [saveRemoteDialog, setSaveRemoteDialog] = useState<{ url: string; name: string } | null>(null)
  const [openEntryMenuUrl, setOpenEntryMenuUrl] = useState<string | null>(null)
  const treeMenuRef = useRef<HTMLDivElement | null>(null)
  const [fileViewer, setFileViewer] = useState<FileViewerState>({
    open: false, url: '', name: '', content: null, loading: false, error: null
  })
  const [remoteFileDiff, setRemoteFileDiff] = useState<RemoteFileDiffState | null>(null)

  // Per-server navigation state cache
  interface ServerNavState {
    tree: RemoteEntry[]
    expandedUrls: Set<string>
    childrenCache: Record<string, RemoteEntry[]>
  }
  const serverStateCache = useRef<Record<string, ServerNavState>>({})
  const prevRemoteId = useRef<string | null>(null)

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
    if (!openEntryMenuUrl) return

    const handleClickOutside = (event: MouseEvent) => {
      if (treeMenuRef.current && !treeMenuRef.current.contains(event.target as Node)) {
        setOpenEntryMenuUrl(null)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenEntryMenuUrl(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [openEntryMenuUrl])

  useEffect(() => {
    if (!activeRemote?.id) return

    const prevId = prevRemoteId.current

    // Save navigation state for the previous server
    if (prevId && prevId !== activeRemote.id) {
      serverStateCache.current[prevId] = {
        tree,
        expandedUrls,
        childrenCache
      }
    }

    // Restore cached state for this server, or reset if first visit
    const cached = serverStateCache.current[activeRemote.id]
    if (cached) {
      setTree(cached.tree)
      setExpandedUrls(cached.expandedUrls)
      setChildrenCache(cached.childrenCache)
      setLoadingChildrenUrls(new Set())
    } else {
      setTree([])
      setExpandedUrls(new Set())
      setChildrenCache({})
      setLoadingChildrenUrls(new Set())
    }

    setError(null)
    setServerUrl(activeRemote.url)
    setOpenEntryMenuUrl(null)
    prevRemoteId.current = activeRemote.id
  }, [activeRemote?.id])

  const saveServerUrl = () => {
    const nextUrl = serverUrl.trim()
    if (!nextUrl) {
      toast('Ingresa una URL de servidor SVN válida', 'error')
      return
    }
    setSaveRemoteDialog({ url: nextUrl, name: suggestRemoteName(nextUrl) })
  }

  const submitSaveRemote = async () => {
    if (!saveRemoteDialog) return
    const name = saveRemoteDialog.name.trim()
    if (!name) { toast('El nombre es requerido', 'error'); return }
    try {
      await onSaveRemote(name, saveRemoteDialog.url)
      setSaveRemoteDialog(null)
    } catch (err: any) {
      toast(normalizeError(err) || 'No se pudo guardar el servidor remoto', 'error')
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
    setOpenEntryMenuUrl(null)
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

    // Update URL bar to reflect current navigation position
    setServerUrl(entry.url)

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
      toast('Repositorio clonado correctamente', 'success')
      onCheckoutDone()
      // Refresh tree to show updated isCheckedOut status
      setTimeout(() => {
        loadRoot()
        setCheckout(null)
      }, 1500)
    } catch (err: any) {
      setCheckout((prev) => prev ? { ...prev, running: false } : null)
      toast(normalizeError(err) || 'Error al clonar el repositorio', 'error')
    } finally {
      unsub()
    }
  }

  const startExport = (entry: RemoteEntry) => {
    const nameParts = entry.url.split('/')
    const defaultName = nameParts[nameParts.length - 1].replace(/\/$/, '') || 'exportacion'
    setSvnExportDialog({ url: entry.url, targetDir: '', name: defaultName, running: false, log: '', done: false, resultPath: '' })
  }

  const pickExportFolder = async () => {
    const svn = getSvnApi()
    const dir = await svn.pickExportFolder()
    if (dir) setSvnExportDialog((prev) => prev ? { ...prev, targetDir: dir } : null)
  }

  const doExport = async () => {
    if (!svnExportDialog) return
    if (!svnExportDialog.targetDir) { toast('Selecciona una carpeta de destino', 'error'); return }
    if (!svnExportDialog.name.trim()) { toast('Escribe un nombre para la carpeta', 'error'); return }
    const targetPath = `${svnExportDialog.targetDir}/${svnExportDialog.name.trim()}`
    setSvnExportDialog((prev) => prev ? { ...prev, running: true, log: '', resultPath: targetPath } : null)
    let unsub = () => {}
    try {
      const svn = getSvnApi()
      unsub = svn.onExportProgress((msg: string) => {
        setSvnExportDialog((prev) => prev ? { ...prev, log: prev.log + msg } : null)
      })
      await svn.svnExport(svnExportDialog.url, targetPath)
      setSvnExportDialog((prev) => prev ? { ...prev, running: false, done: true } : null)
      toast('Exportación completada correctamente', 'success')
    } catch (err: any) {
      setSvnExportDialog((prev) => prev ? { ...prev, running: false } : null)
      toast(normalizeError(err) || 'Error al exportar', 'error')
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
      selected: null,
      repoRoot: null
    })

    try {
      const svn = getSvnApi()
      const [entries, repoRoot] = await Promise.all([
        svn.remoteLog(entry.url, 100),
        svn.getRepoRoot(entry.url).catch(() => null)
      ])
      setRemoteLog((prev) => ({
        ...prev,
        loading: false,
        entries,
        selected: entries.length > 0 ? entries[0] : null,
        repoRoot
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

  const openSearch = (entry: RemoteEntry) => {
    setSearchDialog({
      open: true,
      url: entry.url,
      folderName: entry.name.replace(/\/$/, ''),
      query: '',
      deepSearch: false,
      running: false,
      results: [],
      searched: false,
      error: null,
      searchProgress: null
    })
  }

  const runSearch = async () => {
    const q = searchDialog.query.trim()
    if (!q) {
      toast('Escribe un término de búsqueda', 'error')
      return
    }

    // Cancel any previous search listeners
    searchUnsubsRef.current.forEach((fn) => fn())
    searchUnsubsRef.current = []

    setSearchDialog((prev) => ({
      ...prev,
      running: true,
      results: [],
      searched: false,
      error: null,
      searchProgress: null
    }))

    const svn = getSvnApi()

    const unsubResult = svn.onSearchResult((result: RemoteSearchResult) => {
      setSearchDialog((prev) => ({ ...prev, results: [...prev.results, result] }))
    })
    const unsubProgress = svn.onSearchProgress((data: { searched: number; total: number }) => {
      setSearchDialog((prev) => ({ ...prev, searchProgress: data }))
    })
    const unsubDone = svn.onSearchDone((data: { searched: number; total: number }) => {
      setSearchDialog((prev) => ({ ...prev, searchProgress: data }))
    })

    searchUnsubsRef.current = [unsubResult, unsubProgress, unsubDone]

    try {
      await svn.searchRemote(searchDialog.url, q, searchDialog.deepSearch)
      setSearchDialog((prev) => ({ ...prev, running: false, searched: true }))
    } catch (err: any) {
      setSearchDialog((prev) => ({
        ...prev,
        running: false,
        searched: true,
        error: normalizeError(err) || 'Error al buscar'
      }))
    } finally {
      searchUnsubsRef.current.forEach((fn) => fn())
      searchUnsubsRef.current = []
    }
  }

  const closeSearch = () => {
    searchUnsubsRef.current.forEach((fn) => fn())
    searchUnsubsRef.current = []
    setSearchDialog({
      open: false,
      url: '',
      folderName: '',
      query: '',
      deepSearch: false,
      running: false,
      results: [],
      searched: false,
      error: null,
      searchProgress: null
    })
  }

  const openFileViewer = async (entry: RemoteEntry) => {
    const ext = entry.name.split('.').pop()?.toLowerCase() || ''
    if (BINARY_EXTENSIONS.has(ext)) {
      setFileViewer({ open: true, url: entry.url, name: entry.name, content: null, loading: false, error: `No se puede previsualizar archivos binarios (.${ext})` })
      return
    }
    setFileViewer({ open: true, url: entry.url, name: entry.name, content: null, loading: true, error: null })
    try {
      const svn = getSvnApi()
      const content = await svn.remoteFileContent(entry.url)
      setFileViewer(prev => ({ ...prev, content, loading: false }))
    } catch (err: any) {
      setFileViewer(prev => ({ ...prev, loading: false, error: normalizeError(err) || 'Error al obtener el archivo' }))
    }
  }

  const openRemoteFileDiff = async (svnPath: string, revision: number) => {
    const parts = svnPath.split('/')
    const fileName = parts[parts.length - 1] || svnPath
    setRemoteFileDiff({ svnPath, fileName, diff: null, loading: true })
    try {
      const svn = getSvnApi()
      const diff = await svn.remoteRevisionDiff(remoteLog.url, svnPath, revision)
      setRemoteFileDiff({ svnPath, fileName, diff, loading: false })
    } catch (err: any) {
      toast(normalizeError(err) || 'Error al obtener el diff', 'error')
      setRemoteFileDiff(null)
    }
  }

  const renderEntry = (entry: RemoteEntry, depth = 0) => {
    const isDir = entry.kind === 'dir'
    const isExpanded = expandedUrls.has(entry.url)
    const isMenuOpen = openEntryMenuUrl === entry.url
    const children = childrenCache[entry.url]
    const isLoadingChildren = loadingChildrenUrls.has(entry.url)
    const hasLoadedChildren = Object.prototype.hasOwnProperty.call(childrenCache, entry.url)

    return (
      <div key={entry.url}>
        <div
          className={`tree-item ${isExpanded ? 'expanded' : ''} ${isLoadingChildren ? 'loading' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
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
            onClick={() => isDir ? toggleExpand(entry) : openFileViewer(entry)}
            style={{ cursor: isLoadingChildren ? 'wait' : 'pointer' }}
          >
            {isDir ? (isExpanded ? '📂' : '📁') : getFileIcon(entry.name)}
          </span>

          {/* Body: name + subtitle */}
          <div
            className="tree-item-body"
            onClick={() => isDir ? toggleExpand(entry) : openFileViewer(entry)}
            style={{ cursor: isLoadingChildren ? 'wait' : 'pointer' }}
          >
            <span className="tree-item-name">{entry.name.replace(/\/$/, '')}</span>
            {(entry.author || entry.date) && (
              <div className="tree-item-subtitle">
                {entry.author && <span className="tree-item-author-text">{entry.author}</span>}
                {entry.author && entry.date && <span className="tree-item-dot">·</span>}
                {entry.date && <span className="tree-item-date-text">{formatDateShort(entry.date)}</span>}
              </div>
            )}
          </div>

          {/* Meta */}
          <span className="tree-item-meta">r{entry.revision}</span>

          {/* Checked out badge */}
          {entry.isCheckedOut && (
            <span className="tree-item-checked">✓ Local</span>
          )}

          <div className="tree-item-actions">
            <button
              className="tree-menu-btn"
              title="Opciones"
              onClick={(e) => {
                e.stopPropagation()
                setOpenEntryMenuUrl(isMenuOpen ? null : entry.url)
              }}
            >
              ···
            </button>

            {isMenuOpen && (
              <div className="tree-item-dropdown" ref={treeMenuRef}>
                <button
                  className="tree-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenEntryMenuUrl(null)
                    openRemoteLog(entry)
                  }}
                >
                  🕘 Ver log
                </button>
                <button
                  className="tree-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenEntryMenuUrl(null)
                    navigator.clipboard.writeText(entry.url)
                    toast('URL copiada', 'success')
                  }}
                >
                  📋 Copiar URL
                </button>
                <button
                  className="tree-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenEntryMenuUrl(null)
                    navigator.clipboard.writeText(String(entry.revision))
                    toast('Revisión copiada', 'success')
                  }}
                >
                  📋 Copiar revisión (r{entry.revision})
                </button>
                <button
                  className="tree-dropdown-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenEntryMenuUrl(null)
                    navigator.clipboard.writeText(`${entry.url}@${entry.revision}`)
                    toast('URL@revisión copiada', 'success')
                  }}
                >
                  📋 Copiar URL@revisión
                </button>
                {!isDir && (
                  <>
                    <div className="tree-dropdown-divider" />
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        openFileViewer(entry)
                      }}
                    >
                      👁 Ver archivo
                    </button>
                  </>
                )}
                {isDir && (
                  <>
                    <div className="tree-dropdown-divider" />
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        startCheckout(entry)
                      }}
                    >
                      {entry.isCheckedOut ? '🔁 Volver a clonar' : '🧬 Clonar repositorio'}
                    </button>
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        startExport(entry)
                      }}
                    >
                      📦 Descargar copia
                    </button>
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        openCreateRemoteDialog('folder', entry)
                      }}
                    >
                      📁 Crear subcarpeta
                    </button>
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        openCreateRemoteDialog('file', entry)
                      }}
                    >
                      📄 Crear archivo
                    </button>
                    <div className="tree-dropdown-divider" />
                    <button
                      className="tree-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenEntryMenuUrl(null)
                        openSearch(entry)
                      }}
                    >
                      🔍 Buscar en esta carpeta
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
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
        <span className="explorer-toolbar-title">🌐 Servidor SVN</span>
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
        {!credentials ? (
          <button
            className="btn btn-ghost explorer-toolbar-warning"
            onClick={() => onRequestCredentials(serverUrl)}
          >
            ⚠️ Sin credenciales
          </button>
        ) : (
          <span className="explorer-toolbar-user">
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

      {/* Save remote dialog */}
      {saveRemoteDialog && (
        <div className="overlay">
          <div className="dialog" style={{ width: 480 }}>
            <div className="dialog-title">💾 Guardar como servidor remoto</div>
            <div className="form-field">
              <label className="form-label">URL</label>
              <input
                className="form-input"
                value={saveRemoteDialog.url}
                onChange={(e) => setSaveRemoteDialog((prev) => prev ? { ...prev, url: e.target.value } : null)}
                placeholder="https://servidor/svn"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Nombre</label>
              <input
                className="form-input"
                value={saveRemoteDialog.name}
                onChange={(e) => setSaveRemoteDialog((prev) => prev ? { ...prev, name: e.target.value } : null)}
                placeholder="Mi Servidor SVN"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') submitSaveRemote() }}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-default" onClick={() => setSaveRemoteDialog(null)}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={submitSaveRemote}
                disabled={!saveRemoteDialog.name.trim()}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="history-rev">r{entry.revision}</div>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', fontSize: 10, lineHeight: 1.4, opacity: 0.55 }}
                          title="Copiar revisión"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(String(entry.revision))
                            toast('Revisión copiada', 'success')
                          }}
                        >
                          📋
                        </button>
                      </div>
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
                    <div className="history-detail-rev" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Revisión {remoteLog.selected.revision}</span>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '1px 7px', fontSize: 11 }}
                        title="Copiar número de revisión"
                        onClick={() => {
                          navigator.clipboard.writeText(String(remoteLog.selected!.revision))
                          toast('Revisión copiada', 'success')
                        }}
                      >
                        📋 r{remoteLog.selected.revision}
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '1px 7px', fontSize: 11 }}
                        title={`Copiar URL@revisión\n${remoteLog.url}@${remoteLog.selected.revision}`}
                        onClick={() => {
                          navigator.clipboard.writeText(`${remoteLog.url}@${remoteLog.selected!.revision}`)
                          toast('URL@revisión copiada', 'success')
                        }}
                      >
                        📋 URL
                      </button>
                    </div>
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
                        {remoteLog.selected.paths.map((p, i) => {
                          const canDiff = p.action !== 'D'
                          return (
                            <div
                              key={i}
                              className={`history-path-item ${canDiff ? 'history-path-item-clickable' : ''}`}
                              onClick={() => canDiff && openRemoteFileDiff(p.path, remoteLog.selected!.revision)}
                              title={canDiff ? 'Ver diff de este archivo' : ''}
                            >
                              <span title={p.action}>{ACTION_LABEL[p.action] || p.action}</span>
                              <span style={{ flex: 1 }}>{p.path}</span>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '0 5px', fontSize: 10, opacity: 0.6, flexShrink: 0 }}
                                title={remoteLog.repoRoot
                                  ? `Copiar URL@revisión\n${remoteLog.repoRoot}${p.path}@${remoteLog.selected!.revision}`
                                  : `Copiar ruta\n${p.path}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const text = remoteLog.repoRoot
                                    ? `${remoteLog.repoRoot}${p.path}@${remoteLog.selected!.revision}`
                                    : p.path
                                  navigator.clipboard.writeText(text)
                                  toast(remoteLog.repoRoot ? 'URL@revisión copiada' : 'Ruta copiada', 'success')
                                }}
                              >
                                📋
                              </button>
                              {canDiff && <span className="history-path-diff-hint">Ver diff →</span>}
                            </div>
                          )
                        })}
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
                  setRemoteLog({ open: false, url: '', title: '', loading: false, entries: [], selected: null, repoRoot: null })
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

      {/* Search dialog */}
      {searchDialog.open && (
        <div className="overlay">
          <div className="dialog" style={{ width: 600, maxWidth: '90vw' }}>
            <div className="dialog-title">🔍 Buscar en carpeta</div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {searchDialog.folderName} · {searchDialog.url}
            </div>

            <div className="form-field" style={{ marginTop: 16 }}>
              <input
                className="form-input"
                value={searchDialog.query}
                onChange={(e) => setSearchDialog((prev) => ({ ...prev, query: e.target.value }))}
                placeholder="Nombre de archivo o carpeta..."
                autoFocus
                disabled={searchDialog.running}
                onKeyDown={(e) => { if (e.key === 'Enter' && !searchDialog.running) runSearch() }}
              />
            </div>

            <label className="search-deep-label">
              <input
                type="checkbox"
                checked={searchDialog.deepSearch}
                onChange={(e) => setSearchDialog((prev) => ({ ...prev, deepSearch: e.target.checked }))}
                disabled={searchDialog.running}
              />
              <span>Búsqueda profunda (buscar también en contenido de archivos)</span>
            </label>

            {searchDialog.running && (
              <div className="search-running">
                <div className="spinner" />
                {searchDialog.searchProgress?.listingStats ? (
                  // Phase 1: BFS directory exploration
                  <span>
                    Explorando… {searchDialog.searchProgress.listingStats.entries} entradas
                    en {searchDialog.searchProgress.listingStats.dirs} carpetas
                  </span>
                ) : searchDialog.deepSearch && searchDialog.searchProgress && searchDialog.searchProgress.total > 0 ? (
                  // Phase 2: parallel content search
                  <div className="search-running-detail">
                    <span>Buscando en contenido… {searchDialog.searchProgress.searched} de {searchDialog.searchProgress.total} archivos</span>
                    <div className="search-progress-bar-wrap">
                      <div
                        className="search-progress-bar-fill"
                        style={{
                          width: `${Math.round((searchDialog.searchProgress.searched / searchDialog.searchProgress.total) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <span>Buscando…</span>
                )}
              </div>
            )}

            {/* Results appear progressively as they stream in */}
            {searchDialog.results.length > 0 && (
              <div className="search-results">
                <div className="search-results-header">
                  {searchDialog.results.length} resultado{searchDialog.results.length !== 1 ? 's' : ''}
                  {searchDialog.running && <span className="search-results-streaming"> · buscando…</span>}
                </div>
                <div className="search-results-list">
                  {searchDialog.results.map((r, i) => (
                    <div key={i} className="search-result-item">
                      <span className="search-result-icon">
                        {r.kind === 'revision' ? '🕘' : r.kind === 'dir' ? '📁' : getFileIcon(r.name)}
                      </span>
                      <div className="search-result-body">
                        <span className="search-result-name">
                          {r.kind === 'revision'
                            ? <><strong>{r.name}</strong></>
                            : highlightText(r.name, searchDialog.query)
                          }
                        </span>
                        <span className="search-result-path">
                          {r.kind === 'revision'
                            ? highlightText(r.revisionMessage || r.path, searchDialog.query)
                            : r.path
                          }
                        </span>
                      </div>
                      <span className={`search-result-badge ${r.matchType}`}>
                        {r.matchType === 'name' ? 'nombre' : r.matchType === 'comment' ? 'comentario' : 'contenido'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* "No results" only shown after search completes with zero results */}
            {searchDialog.searched && !searchDialog.running && !searchDialog.error && searchDialog.results.length === 0 && (
              <div className="search-results">
                <div className="search-empty">No se encontraron resultados para "{searchDialog.query}"</div>
              </div>
            )}

            {searchDialog.searched && searchDialog.error && (
              <div className="search-results">
                <div className="search-error">{searchDialog.error}</div>
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn btn-default" onClick={closeSearch} disabled={searchDialog.running}>
                Cerrar
              </button>
              <button
                className="btn btn-primary"
                onClick={runSearch}
                disabled={searchDialog.running || !searchDialog.query.trim()}
              >
                {searchDialog.running ? '⟳ Buscando...' : '🔍 Buscar'}
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
              {checkout.done ? '✅ Clonación completada' : '🧬 Clonar repositorio'}
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
                {checkout.log || 'Iniciando clonación...'}
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
                  {checkout.running ? '⟳ Clonando...' : '🧬 Clonar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export dialog */}
      {svnExportDialog && (
        <div className="overlay">
          <div className="dialog" style={{ width: 480 }}>
            <div className="dialog-title">
              {svnExportDialog.done ? '✅ Exportación completada' : '📦 Descargar copia'}
            </div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {svnExportDialog.url}
            </div>

            {!svnExportDialog.running && !svnExportDialog.done && (
              <>
                <div className="form-field">
                  <label className="form-label">Carpeta de destino</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="form-input"
                      value={svnExportDialog.targetDir}
                      readOnly
                      placeholder="Selecciona una carpeta..."
                      style={{ flex: 1, color: svnExportDialog.targetDir ? undefined : 'var(--text3)' }}
                    />
                    <button className="btn btn-default" onClick={pickExportFolder}>
                      Seleccionar...
                    </button>
                  </div>
                </div>
                <div className="form-field">
                  <label className="form-label">Nombre de la carpeta</label>
                  <input
                    className="form-input"
                    value={svnExportDialog.name}
                    onChange={(e) => setSvnExportDialog((prev) => prev ? { ...prev, name: e.target.value } : null)}
                    placeholder="nombre-exportacion"
                    autoFocus
                  />
                  {svnExportDialog.targetDir && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      Se guardará en: {svnExportDialog.targetDir}/{svnExportDialog.name}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    Sin metadatos SVN — copia independiente de archivos
                  </div>
                </div>
              </>
            )}

            {(svnExportDialog.running || svnExportDialog.done) && (
              <div className="progress-log" style={{ marginBottom: 12, height: 120 }}>
                {svnExportDialog.log || 'Iniciando exportación...'}
              </div>
            )}

            {svnExportDialog.running && (
              <div className="progress-bar-wrap">
                <div className="progress-bar" />
              </div>
            )}

            {svnExportDialog.done && svnExportDialog.resultPath && (
              <div style={{ marginBottom: 12 }}>
                <button
                  className="btn btn-default"
                  style={{ width: '100%' }}
                  onClick={() => getSvnApi().openFolder(svnExportDialog.resultPath)}
                >
                  📁 Abrir en Finder
                </button>
              </div>
            )}

            <div className="dialog-actions">
              <button
                className="btn btn-default"
                onClick={() => setSvnExportDialog(null)}
                disabled={svnExportDialog.running}
              >
                {svnExportDialog.done ? 'Cerrar' : 'Cancelar'}
              </button>
              {!svnExportDialog.done && (
                <button
                  className="btn btn-primary"
                  onClick={doExport}
                  disabled={svnExportDialog.running || !svnExportDialog.targetDir || !svnExportDialog.name.trim()}
                >
                  {svnExportDialog.running ? '⟳ Exportando...' : '📦 Exportar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remote file diff modal */}
      {remoteFileDiff && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setRemoteFileDiff(null) }}>
          <div className="dialog" style={{ width: '85vw', maxWidth: 1100, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Diff · {remoteFileDiff.fileName}</span>
              {remoteLog.selected && (
                <span style={{ fontSize: 11, fontWeight: 400, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--accent)', background: '#dbeafe', borderRadius: 10, padding: '2px 8px' }}>
                  r{remoteLog.selected.revision}
                </span>
              )}
              <button
                className="btn btn-ghost"
                style={{ marginLeft: 'auto', padding: '2px 8px' }}
                onClick={() => setRemoteFileDiff(null)}
              >
                ✕
              </button>
            </div>
            <div className="dialog-sub" style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', marginBottom: 8 }}>
              {remoteFileDiff.svnPath}
            </div>
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {remoteFileDiff.loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                  <div className="spinner spinner-lg" />
                </div>
              ) : remoteFileDiff.diff && remoteFileDiff.diff.includes('@@') ? (
                <DiffViewer diff={remoteFileDiff.diff} filePath={remoteFileDiff.fileName} />
              ) : (
                <div style={{ padding: 24, color: 'var(--text2)', fontSize: 13 }}>
                  {remoteFileDiff.diff || '(sin cambios)'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* File viewer dialog */}
      {fileViewer.open && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setFileViewer(prev => ({ ...prev, open: false })) }}>
          <div className="dialog" style={{ width: '85vw', maxWidth: 1000, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{getFileIcon(fileViewer.name)} {fileViewer.name}</span>
              <button
                className="btn btn-ghost"
                style={{ marginLeft: 'auto', padding: '2px 8px' }}
                onClick={() => setFileViewer(prev => ({ ...prev, open: false }))}
              >
                ✕
              </button>
            </div>
            <div style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11, color: 'var(--text3)', marginBottom: 8, wordBreak: 'break-all' }}>
              {fileViewer.url}
            </div>
            {fileViewer.loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner spinner-lg" />
              </div>
            ) : fileViewer.error ? (
              <div style={{ padding: 20, color: 'var(--danger)', fontSize: 13 }}>{fileViewer.error}</div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <pre style={{ margin: 0, padding: 16, fontFamily: 'SF Mono, Menlo, monospace', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)' }}>
                  {fileViewer.content || '(archivo vacío)'}
                </pre>
              </div>
            )}
            {!fileViewer.loading && fileViewer.content && (
              <div className="dialog-actions" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-default"
                  onClick={() => {
                    navigator.clipboard.writeText(fileViewer.content || '')
                    toast('Copiado al portapapeles', 'success')
                  }}
                >
                  📋 Copiar
                </button>
                <button
                  className="btn btn-default"
                  onClick={() => setFileViewer(prev => ({ ...prev, open: false }))}
                >
                  Cerrar
                </button>
              </div>
            )}
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
