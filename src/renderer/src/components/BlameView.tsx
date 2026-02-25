import { useState, useEffect } from 'react'
import { BlameLine, LocalRepo } from '../types/svn'

interface Props {
  repo: LocalRepo
  filePath: string
  onClose: () => void
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-GT', { year: '2-digit', month: '2-digit', day: '2-digit' })
}

/** Generates a stable pastel color for each author name */
function authorColor(author: string): string {
  let hash = 0
  for (let i = 0; i < author.length; i++) {
    hash = author.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 45%, 88%)`
}

export default function BlameView({ repo, filePath, onClose, toast }: Props) {
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredRev, setHoveredRev] = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const result = await window.svn.blame(repo.path, filePath)
        setLines(result)
      } catch (err: any) {
        toast(err.message || 'Error al cargar blame', 'error')
        onClose()
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [repo.path, filePath])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg2)',
          flexShrink: 0
        }}
      >
        <button
          className="btn btn-ghost"
          style={{ padding: '2px 8px', fontSize: 12 }}
          onClick={onClose}
        >
          ← Volver
        </button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Blame — {filePath}</span>
        {!loading && (
          <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 'auto' }}>
            {lines.length} líneas
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <div className="spinner spinner-lg" />
          <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text2)' }}>
            Cargando anotaciones...
          </span>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace", fontSize: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10, color: 'var(--text2)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Línea</th>
                <th style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10, color: 'var(--text2)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Rev</th>
                <th style={{ textAlign: 'left', padding: '4px 10px', fontSize: 10, color: 'var(--text2)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Autor</th>
                <th style={{ textAlign: 'left', padding: '4px 10px', fontSize: 10, color: 'var(--text2)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '4px 10px', fontSize: 10, color: 'var(--text2)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Contenido</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const prevLine = i > 0 ? lines[i - 1] : null
                const sameBlock = prevLine?.revision === line.revision && prevLine?.author === line.author
                const bgColor = hoveredRev === line.revision
                  ? authorColor(line.author).replace('88%)', '75%)')
                  : sameBlock ? 'transparent' : authorColor(line.author)
                return (
                  <tr
                    key={i}
                    style={{ background: bgColor, cursor: 'default' }}
                    onMouseEnter={() => setHoveredRev(line.revision)}
                    onMouseLeave={() => setHoveredRev(null)}
                    title={`r${line.revision} — ${line.author} — ${formatDateShort(line.date)}`}
                  >
                    <td style={{ textAlign: 'right', padding: '1px 10px', color: 'var(--text3)', userSelect: 'none', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {line.lineNum}
                    </td>
                    <td style={{ textAlign: 'right', padding: '1px 8px', color: 'var(--accent)', userSelect: 'none', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {!sameBlock ? `r${line.revision}` : ''}
                    </td>
                    <td style={{ padding: '1px 8px', color: 'var(--text2)', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                      {!sameBlock ? line.author : ''}
                    </td>
                    <td style={{ padding: '1px 8px', color: 'var(--text3)', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                      {!sameBlock ? formatDateShort(line.date) : ''}
                    </td>
                    <td style={{ padding: '1px 10px', whiteSpace: 'pre', color: 'var(--text)' }}>
                      {line.content}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
