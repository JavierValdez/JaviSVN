import PdfViewer from './PdfViewer'
import WordPreview from './WordPreview'

export interface PdfPreviewState {
  title: string
  subtitle: string
  base64: string | null
  loading: boolean
  error: string | null
  badge?: string | null
  fileType?: 'pdf' | 'word'
}

interface Props {
  state: PdfPreviewState | null
  onClose: () => void
}

export default function PdfPreviewDialog({ state, onClose }: Props) {
  if (!state) return null

  const ft = state.fileType || 'pdf'

  return (
    <div
      className="overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dialog pdf-preview-dialog">
        <div className="dialog-title pdf-preview-header">
          <span>{ft === 'word' ? '📘' : '📕'} {state.title}</span>
          {state.badge && <span className="pdf-preview-badge">{state.badge}</span>}
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 'auto', padding: '2px 8px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="dialog-sub pdf-preview-subtitle">{state.subtitle}</div>
        <div className="pdf-preview-body">
          {state.loading ? (
            <div className="pdf-viewer-placeholder">
              <div className="spinner spinner-lg" />
              <span style={{ color: 'var(--text2)', marginTop: 12 }}>
                Cargando {ft === 'word' ? 'documento' : 'PDF'}...
              </span>
            </div>
          ) : state.error ? (
            <div className="pdf-viewer-placeholder pdf-preview-error">
              <span style={{ fontSize: 32 }}>⚠️</span>
              <span>{state.error}</span>
            </div>
          ) : state.base64 ? (
            ft === 'word'
              ? <WordPreview base64={state.base64} />
              : <PdfViewer base64={state.base64} />
          ) : (
            <div className="pdf-viewer-placeholder">
              <span style={{ fontSize: 32 }}>📄</span>
              <span>No se pudo cargar el archivo</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
