import { useState, useEffect } from 'react'
import { LocalRepo } from '../types/svn'

interface Props {
  repo: LocalRepo
  filePath: string
  onResolved: () => void
  onClose: () => void
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

export default function ConflictResolver({ repo, filePath, onResolved, onClose, toast }: Props) {
  const [mine, setMine] = useState('')
  const [theirs, setTheirs] = useState('')
  const [base, setBase] = useState('')
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const content = await window.svn.getConflictContent(repo.path, filePath)
        setMine(content.mine)
        setTheirs(content.theirs)
        setBase(content.base)
      } catch (err: any) {
        toast(err.message || 'No se pudieron cargar los archivos de conflicto', 'error')
        onClose()
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [repo.path, filePath])

  const resolve = async (accept: 'mine-full' | 'theirs-full' | 'working') => {
    setResolving(true)
    try {
      await window.svn.resolve(repo.path, filePath, accept)
      toast('Conflicto resuelto correctamente', 'success')
      onResolved()
    } catch (err: any) {
      toast(err.message || 'Error al resolver el conflicto', 'error')
    } finally {
      setResolving(false)
    }
  }

  const panelStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r)',
    overflow: 'hidden',
    minWidth: 0
  }

  const panelHeaderStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    flexShrink: 0
  }

  const panelBodyStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
    fontSize: 11,
    padding: '8px 12px',
    whiteSpace: 'pre',
    color: 'var(--text)'
  }

  return (
    <div
      className="overlay"
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 'var(--r2)',
          width: '92vw',
          maxWidth: 1100,
          height: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.25)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>⚠️ Conflicto — {filePath}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>
            Elige cómo resolver el conflicto
          </span>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 'auto', padding: '2px 8px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <div className="spinner spinner-lg" />
            <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text2)' }}>
              Cargando versiones...
            </span>
          </div>
        ) : (
          <>
            {/* Three-panel diff */}
            <div style={{ flex: 1, display: 'flex', gap: 8, padding: 12, overflow: 'hidden' }}>
              <div style={panelStyle}>
                <div style={{ ...panelHeaderStyle, color: 'var(--success)' }}>
                  Mi versión (.mine)
                </div>
                <div style={panelBodyStyle}>{mine || '(vacío)'}</div>
              </div>
              <div style={panelStyle}>
                <div style={{ ...panelHeaderStyle, color: 'var(--text2)' }}>
                  Base común
                </div>
                <div style={panelBodyStyle}>{base || '(vacío)'}</div>
              </div>
              <div style={panelStyle}>
                <div style={{ ...panelHeaderStyle, color: 'var(--accent)' }}>
                  Versión del servidor (.rNEW)
                </div>
                <div style={panelBodyStyle}>{theirs || '(vacío)'}</div>
              </div>
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '10px 16px',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
                flexWrap: 'wrap'
              }}
            >
              <button
                className="btn btn-default"
                style={{ color: 'var(--success)', borderColor: 'var(--success)' }}
                onClick={() => resolve('mine-full')}
                disabled={resolving}
                title="Descartar cambios del servidor y conservar mis cambios"
              >
                ✓ Aceptar mi versión
              </button>
              <button
                className="btn btn-default"
                style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                onClick={() => resolve('theirs-full')}
                disabled={resolving}
                title="Descartar mis cambios y usar la versión del servidor"
              >
                ✓ Aceptar versión del servidor
              </button>
              <button
                className="btn btn-default"
                onClick={async () => {
                  await window.svn.openFile(repo.path, filePath)
                  toast('Edita el archivo y luego haz click en "Marcar resuelto"', 'info')
                }}
                disabled={resolving}
                title="Abrir archivo en editor para editar manualmente"
              >
                ✏️ Editar manualmente
              </button>
              <button
                className="btn btn-primary"
                style={{ marginLeft: 'auto' }}
                onClick={() => resolve('working')}
                disabled={resolving}
                title="Marcar como resuelto con el contenido actual del archivo de trabajo"
              >
                {resolving ? 'Resolviendo...' : '✓ Marcar como resuelto'}
              </button>
              <button className="btn btn-ghost" onClick={onClose} disabled={resolving}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
