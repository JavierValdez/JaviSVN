export interface PdfPreviewState {
  title: string
  subtitle: string
  fileUrl: string | null
  loading: boolean
  error: string | null
  badge?: string | null
}

interface Props {
  state: PdfPreviewState | null
  onClose: () => void
}

export default function PdfPreviewDialog({ state, onClose }: Props) {
  if (!state) return null

  const viewerUrl = state.fileUrl ? `${state.fileUrl}#toolbar=1&navpanes=0&view=FitH` : ''

  return (
    <div className="overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="dialog pdf-preview-dialog">
        <div className="dialog-title pdf-preview-header">
          <span>📕 {state.title}</span>
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
            <div className="pdf-preview-placeholder">
              <div className="spinner spinner-lg" />
            </div>
          ) : state.error ? (
            <div className="pdf-preview-placeholder pdf-preview-error">{state.error}</div>
          ) : viewerUrl ? (
            <iframe
              key={viewerUrl}
              className="pdf-preview-frame"
              src={viewerUrl}
              title={state.title}
            />
          ) : (
            <div className="pdf-preview-placeholder">No se pudo preparar el archivo PDF</div>
          )}
        </div>
      </div>
    </div>
  )
}
