import { useState, useEffect } from 'react'
import { FileChange, LocalRepo } from '../types/svn'
import DiffViewer from './DiffViewer'

interface Props {
  repo: LocalRepo
  changes: FileChange[]
  loading: boolean
  onRefresh: () => void
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

export default function ChangesView({ repo, changes, loading, onRefresh, toast }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [reverting, setReverting] = useState(false)

  // Reset selection when repo or changes change
  useEffect(() => {
    const initial = new Set<string>()
    changes.forEach((c) => {
      if (c.status !== '?') initial.add(c.path)
    })
    setChecked(initial)
    setSelectedFile(null)
    setDiff('')
  }, [repo.path, changes.length])

  const loadDiff = async (filePath: string) => {
    setSelectedFile(filePath)
    setDiffLoading(true)
    try {
      const d = await window.svn.diff(repo.path, filePath)
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
      onRefresh()
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
      onRefresh()
    } catch (err: any) {
      toast(err.message || 'Error al revertir', 'error')
    } finally {
      setReverting(false)
    }
  }

  const sortedChanges = [...changes].sort((a, b) => {
    const order: Record<string, number> = { C: 0, M: 1, A: 2, R: 3, D: 4, '!': 5, '?': 6 }
    return (order[a.status] ?? 9) - (order[b.status] ?? 9)
  })

  return (
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
              className="btn btn-ghost"
              style={{ padding: '2px 6px', fontSize: 11 }}
              onClick={onRefresh}
              title="Recargar estado"
            >
              ⟳
            </button>
            {checked.size > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 6px', fontSize: 11, color: 'var(--danger)' }}
                onClick={() => handleRevert()}
                disabled={reverting}
                title="Revertir seleccionados"
              >
                ↺
              </button>
            )}
          </div>
        </div>

        {loading ? (
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
            {sortedChanges.map((c) => (
              <div
                key={c.path}
                className={`change-item ${selectedFile === c.path ? 'selected' : ''}`}
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
              </div>
            ))}
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
        {diffLoading ? (
          <div className="diff-empty">
            <div className="spinner spinner-lg" />
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
  )
}
