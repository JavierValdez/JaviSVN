import { useEffect, useState } from 'react'
import PdfViewer from './PdfViewer'
import WordPreview from './WordPreview'

export interface PdfPreviewState {
  title: string
  subtitle: string
  fileUrl: string | null
  filePath?: string | null
  loading: boolean
  error: string | null
  badge?: string | null
}

interface Props {
  state: PdfPreviewState | null
  onClose: () => void
}

function getFileType(path: string | null): 'pdf' | 'word' | 'unknown' {
  if (!path) return 'unknown'
  const lower = path.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'word'
  return 'unknown'
}

export default function PdfPreviewDialog({ state, onClose }: Props) {
  const [pdfData, setPdfData] = useState<string | null>(null)
  const [docxData, setDocxData] = useState<string | null>(null)
  const [innerLoading, setInnerLoading] = useState(false)
  const [innerError, setInnerError] = useState<string | null>(null)
  const fileType = getFileType(state?.filePath || null)

  useEffect(() => {
    if (!state?.filePath) {
      setPdfData(null)
      setDocxData(null)
      setInnerLoading(false)
      setInnerError(null)
      return
    }

    let cancelled = false
    setInnerLoading(true)
    setInnerError(null)

    const loadFn = fileType === 'word' ? window.svn.loadDocx : window.svn.loadPdf

    loadFn(state.filePath)
      .then((data) => {
        if (cancelled) return
        if (fileType === 'word') {
          setDocxData(data)
        } else {
          setPdfData(data)
        }
        setInnerLoading(false)
      })
      .catch((err: any) => {
        if (cancelled) return
        setInnerError(err?.message || 'No se pudo cargar el archivo')
        setInnerLoading(false)
      })

    return () => { cancelled = true }
  }, [state?.filePath, fileType])

  if (!state) return null

  const isLoading = state.loading || innerLoading
  const error = state.error || innerError

  return (
    <div
      className="overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog pdf-preview-dialog">
        <div className="dialog-title pdf-preview-header">
          <span>{fileType === 'word' ? '📘' : '📕'} {state.title}</span>
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
          {isLoading ? (
            <div className="pdf-viewer-placeholder">
              <div className="spinner spinner-lg" />
              <span style={{ color: 'var(--text2)', marginTop: 12 }}>
                Cargando {fileType === 'word' ? 'documento' : 'PDF'}...
              </span>
            </div>
          ) : error ? (
            <div className="pdf-viewer-placeholder pdf-preview-error">
              <span style={{ fontSize: 32 }}>⚠️</span>
              <span>{error}</span>
            </div>
          ) : fileType === 'word' && docxData ? (
            <WordPreview base64={docxData} />
          ) : fileType === 'pdf' && pdfData ? (
            <PdfViewer base64={pdfData} />
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
