import { useState, useEffect } from 'react'
import { LocalRepo, LogEntry } from '../types/svn'

interface Props {
  repo: LocalRepo
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

const ACTION_LABEL: Record<string, string> = {
  M: '✏️',
  A: '➕',
  D: '🗑️',
  R: '🔄'
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

export default function HistoryView({ repo, toast }: Props) {
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LogEntry | null>(null)

  useEffect(() => {
    loadLog()
  }, [repo.path])

  const loadLog = async () => {
    setLoading(true)
    try {
      const entries = await window.svn.log(repo.path, 100)
      setLog(entries)
      if (entries.length > 0) setSelected(entries[0])
    } catch (err: any) {
      toast(err.message || 'Error al cargar historial', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="history-layout">
      {/* Left: log list */}
      <div className="history-list">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <div className="spinner spinner-lg" />
          </div>
        ) : log.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">Sin historial</div>
          </div>
        ) : (
          log.map((entry) => (
            <div
              key={entry.revision}
              className={`history-item ${selected?.revision === entry.revision ? 'selected' : ''}`}
              onClick={() => setSelected(entry)}
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

      {/* Right: detail */}
      <div className="history-detail">
        {selected ? (
          <>
            <div className="history-detail-rev">Revisión {selected.revision}</div>
            <div className="history-detail-author">
              👤 {selected.author} · 🕐 {formatDate(selected.date)}
            </div>
            <div className="history-detail-msg">
              {selected.message || '(sin mensaje de commit)'}
            </div>

            {selected.paths.length > 0 && (
              <>
                <div className="history-paths-title">
                  Archivos afectados ({selected.paths.length})
                </div>
                {selected.paths.map((p, i) => (
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
  )
}
