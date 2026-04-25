import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileChange, LocalRepo } from '../types/svn'
import DiffViewer from './DiffViewer'
import BlameView from './BlameView'
import ConflictResolver from './ConflictResolver'
import PdfPreviewDialog, { PdfPreviewState } from './PdfPreviewDialog'

interface Props {
  repo: LocalRepo
  changes: FileChange[]
  loading: boolean
  onRefresh: () => void | Promise<void>
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

const STATUS_LABEL: Record<string, string> = {
  M: 'Modificado',
  A: 'Agregado',
  D: 'Eliminado',
  '?': 'Sin versionar',
  C: 'Conflicto',
  '!': 'Faltante',
  R: 'Reemplazado'
}

const STATUS_CLASS: Record<string, string> = {
  M: 'status-M',
  A: 'status-A',
  D: 'status-D',
  '?': 'status-question',
  C: 'status-C',
  R: 'status-R',
  '!': 'status-D'
}

const STATUS_ICON: Record<string, string> = {
  M: '✏️',
  A: '➕',
  D: '🗑️',
  '?': '📄',
  C: '⚠️',
  R: '🔁',
  '!': '❗'
}

function isPdfFile(path: string): boolean {
  return /\.pdf$/i.test(path)
}

function isWordFile(path: string): boolean {
  return /\.(docx|doc)$/i.test(path)
}

function isPreviewableFile(path: string): boolean {
  return isPdfFile(path) || isWordFile(path)
}

function normalizeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

function buildLocalAbsolutePath(repoPath: string, filePath: string): string {
  const separator = repoPath.includes('\\') ? '\\' : '/'
  const base = repoPath.replace(/[\\/]+$/g, '')
  return `${base}${separator}${filePath.replace(/\//g, separator)}`
}

interface ChangeMenuState {
  change: FileChange
  top: number
  left: number
}

export default function ChangesView({ repo, changes, loading, onRefresh, toast }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [blameFile, setBlameFile] = useState<string | null>(null)
  const [conflictFile, setConflictFile] = useState<string | null>(null)
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState | null>(null)
  const [changeMenu, setChangeMenu] = useState<ChangeMenuState | null>(null)
  const [actionPath, setActionPath] = useState<string | null>(null)
  const changeMenuRef = useRef<HTMLDivElement | null>(null)
  const didSeedChecksRef = useRef(false)

  const changesSignature = changes
    .map((c) => `${c.status}:${c.path}`)
    .sort()
    .join('\n')

  const selectedChange = selectedFile
    ? changes.find((c) => c.path === selectedFile) || null
    : null

  // Reset view when switching repositories.
  useEffect(() => {
    didSeedChecksRef.current = false
    setChecked(new Set())
    setSelectedFile(null)
    setDiff('')
    setBlameFile(null)
    setConflictFile(null)
    setPdfPreview(null)
    setChangeMenu(null)
  }, [repo.path])

  // Preserve the current working state when the change list refreshes.
  useEffect(() => {
    const currentPaths = new Set(changes.map((change) => change.path))

    setChecked((prev) => {
      if (!didSeedChecksRef.current && changes.length > 0) {
        didSeedChecksRef.current = true
        const initial = new Set<string>()
        changes.forEach((change) => {
          if (change.status !== '?') initial.add(change.path)
        })
        return initial
      }

      if (prev.size === 0) return prev
      const next = new Set<string>()
      prev.forEach((path) => {
        if (currentPaths.has(path)) next.add(path)
      })
      return next.size === prev.size ? prev : next
    })

    if (selectedFile && !currentPaths.has(selectedFile)) {
      setSelectedFile(null)
      setDiff('')
      setDiffLoading(false)
      setPdfPreview(null)
    }

    if (blameFile && !currentPaths.has(blameFile)) {
      setBlameFile(null)
    }

    if (conflictFile && !currentPaths.has(conflictFile)) {
      setConflictFile(null)
    }

    if (changeMenu && !currentPaths.has(changeMenu.change.path)) {
      setChangeMenu(null)
    }
  }, [changesSignature, selectedFile, blameFile, conflictFile, changeMenu])

  useEffect(() => {
    if (!changeMenu) return

    const onPointerDown = (event: MouseEvent) => {
      if (changeMenuRef.current && !changeMenuRef.current.contains(event.target as Node)) {
        setChangeMenu(null)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChangeMenu(null)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [changeMenu])

  const openPdfPreview = async (filePath: string) => {
    setPdfPreview({
      title: filePath.split('/').pop() || filePath,
      subtitle: `${repo.name} · ${filePath}`,
      fileUrl: null,
      filePath: null,
      loading: true,
      error: null
    })

    try {
      const preview = await window.svn.getLocalPreviewFile(repo.path, filePath)
      setPdfPreview((prev) => prev ? {
        ...prev,
        title: preview.name,
        fileUrl: preview.fileUrl,
        filePath: preview.path,
        loading: false
      } : prev)
    } catch (err: any) {
      setPdfPreview((prev) => prev ? {
        ...prev,
        loading: false,
        error: err.message || 'No se pudo abrir el PDF'
      } : prev)
    }
  }

  const loadDiff = async (filePath: string) => {
    setSelectedFile(filePath)
    const current = changes.find((c) => c.path === filePath)
    if (current && isPreviewableFile(filePath) && current.status !== 'D' && current.status !== '!') {
      setDiff('')
      setDiffLoading(false)
      await openPdfPreview(filePath)
      return
    }

    setDiffLoading(true)
    try {
      let d = ''
      if (current?.status === '?') {
        if (current.kind === 'dir') {
          d = '(carpeta sin versionar)'
        } else {
          const content = await window.svn.fileContent(repo.path, filePath)
          d = content || '(archivo vacío)'
        }
      } else {
        d = await window.svn.diff(repo.path, filePath)
      }
      setDiff(d)
    } catch {
      setDiff('(no se pudo obtener el diff)')
    } finally {
      setDiffLoading(false)
    }
  }

  const toggleCheck = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleAll = () => {
    if (checked.size === changes.length) {
      setChecked(new Set())
    } else {
      setChecked(new Set(changes.map((c) => c.path)))
    }
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast('Escribe un mensaje de commit', 'error')
      return
    }
    const files = [...checked]
    if (files.length === 0) {
      toast('Selecciona al menos un archivo', 'error')
      return
    }
    setCommitting(true)
    try {
      await window.svn.commit(repo.path, files, commitMsg.trim())
      toast('Commit realizado correctamente', 'success')
      setCommitMsg('')
      setChecked(new Set())
      await onRefresh()
    } catch (err: any) {
      toast(err.message || 'Error al hacer commit', 'error')
    } finally {
      setCommitting(false)
    }
  }

  const handleRevert = async (file?: string) => {
    const files = file ? [file] : [...checked]
    if (files.length === 0) return
    if (!confirm(`¿Revertir ${files.length} archivo(s)? Se perderán los cambios.`)) return
    setReverting(true)
    try {
      await window.svn.revert(repo.path, files)
      toast('Archivos revertidos', 'success')
      if (selectedFile && files.includes(selectedFile)) {
        setSelectedFile(null)
        setDiff('')
      }
      await onRefresh()
    } catch (err: any) {
      toast(err.message || 'Error al revertir', 'error')
    } finally {
      setReverting(false)
    }
  }

  const openChangeMenuAtButton = (change: FileChange, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect()
    const menuWidth = 248
    const menuHeight = 280
    const margin = 12
    const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth))
    const top = rect.bottom + 6 + menuHeight > window.innerHeight - margin
      ? Math.max(margin, rect.top - menuHeight - 6)
      : rect.bottom + 6

    setChangeMenu({ change, top, left })
  }

  const handleOpenChange = async (change: FileChange) => {
    try {
      if (change.kind === 'dir') {
        await window.svn.openFolder(buildLocalAbsolutePath(repo.path, change.path))
      } else {
        await window.svn.openFile(repo.path, change.path)
      }
    } catch (err) {
      toast(normalizeError(err, 'No se pudo abrir el elemento'), 'error')
    }
  }

  const handleCopyPath = async (change: FileChange, mode: 'relative' | 'absolute') => {
    const text = mode === 'absolute'
      ? buildLocalAbsolutePath(repo.path, change.path)
      : change.path

    try {
      await navigator.clipboard.writeText(text)
      toast(mode === 'absolute' ? 'Ruta absoluta copiada' : 'Ruta relativa copiada', 'success')
    } catch (err) {
      toast(normalizeError(err, 'No se pudo copiar la ruta'), 'error')
    }
  }

  const handleAdd = async (change: FileChange, scope: 'item' | 'branch') => {
    setActionPath(change.path)
    setChangeMenu(null)
    try {
      await window.svn.add(repo.path, change.path, scope)
      toast(scope === 'branch' ? 'Rama agregada a SVN' : 'Elemento agregado a SVN', 'success')
      await onRefresh()
    } catch (err) {
      toast(normalizeError(err, 'No se pudo agregar el elemento a SVN'), 'error')
    } finally {
      setActionPath(null)
    }
  }

  const handleIgnore = async (change: FileChange, scope: 'item' | 'branch') => {
    const prompt = scope === 'branch'
      ? `¿Ignorar la rama/carpeta completa asociada a "${change.displayPath}"?`
      : `¿Ignorar "${change.displayPath}" en SVN?`

    if (!confirm(prompt)) return

    setActionPath(change.path)
    setChangeMenu(null)
    try {
      const result = await window.svn.ignore(repo.path, change.path, scope)
      if (result.alreadyPresent) {
        toast('La regla svn:ignore ya existía', 'info')
      } else {
        toast('Regla svn:ignore agregada. Recuerda hacer commit del directorio padre.', 'success')
      }
      await onRefresh()
    } catch (err) {
      toast(normalizeError(err, 'No se pudo agregar a svn:ignore'), 'error')
    } finally {
      setActionPath(null)
    }
  }

  const renderChangeMenu = () => {
    if (!changeMenu) return null

    const { change, top, left } = changeMenu
    const isUnversioned = change.status === '?'
    const isNestedPath = change.path.includes('/')
    const canOpen = !['D', '!'].includes(change.status)
    const canRevertSingle = change.status !== '?'

    return createPortal(
      <div
        className="tree-item-dropdown tree-item-dropdown-floating"
        ref={changeMenuRef}
        style={{ top, left, minWidth: 248 }}
      >
        {canOpen && (
          <button
            className="tree-dropdown-item"
            onClick={() => {
              setChangeMenu(null)
              handleOpenChange(change)
            }}
          >
            {change.kind === 'dir' ? '📂 Abrir carpeta' : '📄 Abrir archivo'}
          </button>
        )}
        <button
          className="tree-dropdown-item"
          onClick={() => {
            setChangeMenu(null)
            handleCopyPath(change, 'relative')
          }}
        >
          📋 Copiar ruta relativa
        </button>
        <button
          className="tree-dropdown-item"
          onClick={() => {
            setChangeMenu(null)
            handleCopyPath(change, 'absolute')
          }}
        >
          📍 Copiar ruta absoluta
        </button>

        {isUnversioned && (
          <>
            <div className="tree-dropdown-divider" />
            <button
              className="tree-dropdown-item"
              onClick={() => handleAdd(change, 'item')}
              disabled={actionPath === change.path}
            >
              ➕ Agregar solo este elemento
            </button>
            {isNestedPath && (
              <button
                className="tree-dropdown-item"
                onClick={() => handleAdd(change, 'branch')}
                disabled={actionPath === change.path}
              >
                🌿 Agregar rama completa
              </button>
            )}
            <button
              className="tree-dropdown-item"
              onClick={() => handleIgnore(change, 'item')}
              disabled={actionPath === change.path}
            >
              🙈 Ignorar este elemento
            </button>
            {isNestedPath && (
              <button
                className="tree-dropdown-item"
                onClick={() => handleIgnore(change, 'branch')}
                disabled={actionPath === change.path}
              >
                🌲 Ignorar rama completa
              </button>
            )}
          </>
        )}

        {canRevertSingle && (
          <>
            <div className="tree-dropdown-divider" />
            <button
              className="tree-dropdown-item"
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setChangeMenu(null)
                handleRevert(change.path)
              }}
              disabled={reverting}
            >
              ↺ Revertir este cambio
            </button>
          </>
        )}
      </div>,
      document.body
    )
  }

  const sortedChanges = [...changes].sort((a, b) => {
    const order: Record<string, number> = { C: 0, M: 1, A: 2, R: 3, D: 4, '!': 5, '?': 6 }
    return (order[a.status] ?? 9) - (order[b.status] ?? 9)
  })

  const canShowBlame = selectedChange ? !['?', 'A', 'D', '!', 'C'].includes(selectedChange.status) : false
  const canPreviewFile = Boolean(selectedChange && isPreviewableFile(selectedChange.path) && !['D', '!'].includes(selectedChange.status))
  const showInitialLoading = loading && changes.length === 0

  return (
    <>
      <div className="changes-layout">
      {/* Left: file list */}
      <div className="changes-list-panel">
        <div className="changes-list-header">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked.size === changes.length && changes.length > 0}
              onChange={toggleAll}
            />
            {changes.length} {changes.length === 1 ? 'archivo' : 'archivos'}
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-default"
              style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={onRefresh}
              disabled={loading}
              title="Recargar estado de archivos"
            >
              ⟳ Actualizar
            </button>
            {checked.size > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 8px', fontSize: 11, color: 'var(--danger)' }}
                onClick={() => handleRevert()}
                disabled={reverting}
                title="Revertir seleccionados"
              >
                ↺ Revertir
              </button>
            )}
          </div>
        </div>

        {showInitialLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : sortedChanges.length === 0 ? (
          <div className="empty-state" style={{ height: 'auto', padding: 24 }}>
            <div className="empty-state-icon" style={{ fontSize: 32 }}>✓</div>
            <div className="empty-state-title" style={{ fontSize: 13 }}>Sin cambios</div>
            <div className="empty-state-sub">El directorio de trabajo está limpio</div>
          </div>
        ) : (
          <div className="changes-list">
            {sortedChanges.map((c) => {
              const isMenuOpen = changeMenu?.change.path === c.path
              const isBusy = actionPath === c.path

              return (
                <div
                  key={c.path}
                  className={`change-item ${selectedFile === c.path ? 'selected' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
                  onClick={() => loadDiff(c.path)}
                  title={`${STATUS_LABEL[c.status] || c.status}: ${c.displayPath}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(c.path)}
                    onChange={() => toggleCheck(c.path)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className={`change-status ${STATUS_CLASS[c.status] || ''}`}>
                    {c.status}
                  </span>
                  <span className="change-path">{c.displayPath}</span>
                  <div className="change-item-actions">
                    <button
                      className="change-menu-btn"
                      title="Acciones"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isMenuOpen) {
                          setChangeMenu(null)
                          return
                        }

                        openChangeMenuAtButton(c, e.currentTarget)
                      }}
                    >
                      ···
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Commit panel */}
        <div className="commit-panel">
          <textarea
            placeholder="Mensaje de commit..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit()
            }}
          />
          <button
            className="btn btn-commit"
            onClick={handleCommit}
            disabled={committing || checked.size === 0 || !commitMsg.trim()}
          >
            {committing ? 'Enviando...' : `Commit a main (${checked.size})`}
          </button>
        </div>
      </div>

      {/* Right: diff viewer */}
      <div className="diff-panel">
        {selectedChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 12px 0' }}>
            <div className={`diff-status-chip ${STATUS_CLASS[selectedChange.status] || ''}`} style={{ margin: 0 }}>
              <span>{STATUS_ICON[selectedChange.status] || '📄'}</span>
              <span>{STATUS_LABEL[selectedChange.status] || selectedChange.status}</span>
            </div>
            {canShowBlame && (
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => setBlameFile(selectedChange.path)}
                title="Ver quién modificó cada línea"
              >
                📖 Blame
              </button>
            )}
            {selectedChange.status === 'C' && (
              <button
                className="btn btn-default"
                style={{ padding: '4px 10px', fontSize: 11, color: 'var(--danger)', borderColor: 'rgba(207,34,46,0.3)' }}
                onClick={() => setConflictFile(selectedChange.path)}
                title="Resolver conflicto SVN"
              >
                ⚠ Resolver conflicto
              </button>
            )}
            {canPreviewFile && (
              <button
                className="btn btn-default"
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => openPdfPreview(selectedChange.path)}
                title="Abrir visor"
              >
                {isWordFile(selectedChange.path) ? '📘 Ver Word' : '📕 Ver PDF'}
              </button>
            )}
          </div>
        )}
        {diffLoading ? (
          <div className="diff-empty">
            <div className="spinner spinner-lg" />
          </div>
        ) : canPreviewFile && selectedChange ? (
          <div className="diff-empty">
            <div className="diff-empty-icon">{isWordFile(selectedChange.path) ? '📘' : '📕'}</div>
            <div className="diff-empty-text">Este archivo se abre en el visor integrado</div>
            <button
              className="btn btn-default"
              style={{ marginTop: 8 }}
              onClick={() => openPdfPreview(selectedChange.path)}
            >
              {isWordFile(selectedChange.path) ? 'Abrir documento Word' : 'Abrir visor PDF'}
            </button>
          </div>
        ) : selectedFile ? (
          <DiffViewer diff={diff} filePath={selectedFile} />
        ) : (
          <div className="diff-empty">
            <div className="diff-empty-icon">📄</div>
            <div className="diff-empty-text">Selecciona un archivo para ver los cambios</div>
          </div>
        )}
      </div>
      </div>
      {blameFile && (
        <BlameView
          repo={repo}
          filePath={blameFile}
          onClose={() => setBlameFile(null)}
          toast={toast}
        />
      )}
      {conflictFile && (
        <ConflictResolver
          repo={repo}
          filePath={conflictFile}
          onClose={() => setConflictFile(null)}
          onResolved={async () => {
            setConflictFile(null)
            await onRefresh()
            if (selectedFile === conflictFile) {
              await loadDiff(conflictFile)
            }
          }}
          toast={toast}
        />
      )}
      <PdfPreviewDialog
        state={pdfPreview}
        onClose={() => setPdfPreview(null)}
      />
      {renderChangeMenu()}
    </>
  )
}
