import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'

interface Props {
  base64: string
}

export default function WordPreview({ base64 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    renderAsync(blob, containerRef.current, undefined, {
      inWrapper: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      className: 'docx-viewer',
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    })
      .then(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((err: any) => {
        if (cancelled) return
        setError(err?.message || 'No se pudo renderizar el documento')
        setLoading(false)
      })

    return () => {
      cancelled = true
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [base64])

  return (
    <div className="word-preview-wrapper">
      {loading && (
        <div className="pdf-viewer-placeholder" style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)' }}>
          <div className="spinner spinner-lg" />
          <span style={{ color: 'var(--text2)', marginTop: 12 }}>Cargando documento...</span>
        </div>
      )}
      {error && (
        <div className="pdf-viewer-placeholder pdf-preview-error" style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)' }}>
          <span style={{ fontSize: 32 }}>⚠️</span>
          <span>{error}</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="word-preview-content"
        style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.2s' }}
      />
    </div>
  )
}
