import { useRef } from 'react'

interface Props {
  diff: string
  filePath: string
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk' | 'header'
  content: string
  lineNum?: number
}

function parseDiff(raw: string): { header: string[]; hunks: DiffLine[][] } {
  const lines = raw.split('\n')
  const header: string[] = []
  const hunks: DiffLine[][] = []
  let currentHunk: DiffLine[] | null = null
  let lineNum = 0

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:') || line.startsWith('=====')) {
      header.push(line)
    } else if (line.startsWith('@@')) {
      currentHunk = [{ type: 'hunk', content: line }]
      hunks.push(currentHunk)
      // Parse line number from @@ -l,s +l,s @@
      const m = line.match(/@@ -\d+,?\d* \+(\d+)/)
      lineNum = m ? parseInt(m[1]) - 1 : 0
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        lineNum++
        currentHunk.push({ type: 'added', content: line.slice(1), lineNum })
      } else if (line.startsWith('-')) {
        currentHunk.push({ type: 'removed', content: line.slice(1) })
      } else if (line.startsWith('\\')) {
        // "No newline at end of file" - skip
      } else {
        lineNum++
        currentHunk.push({ type: 'context', content: line.slice(1), lineNum })
      }
    }
  }

  return { header, hunks }
}

export default function DiffViewer({ diff, filePath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  if (!diff || diff === '(sin cambios)' || diff === '(no se pudo obtener el diff)') {
    return (
      <div className="diff-empty">
        <div className="diff-empty-icon">📝</div>
        <div className="diff-empty-text">{diff || 'Sin cambios para mostrar'}</div>
      </div>
    )
  }

  const { hunks } = parseDiff(diff)

  // For binary/new files show raw
  if (hunks.length === 0 && diff.length > 0) {
    return (
      <div className="diff-container">
        <div className="diff-file-header">📄 {filePath}</div>
        <pre style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>
          {diff}
        </pre>
      </div>
    )
  }

  // Collect content lines (non-hunk) to build minimap data
  const allLines: DiffLine[] = hunks.flat()
  const contentLines = allLines.filter(l => l.type !== 'hunk')
  const totalLines = contentLines.length

  // Positions of changed lines as indices into contentLines
  const changedMarks: { pct: number; type: 'added' | 'removed' }[] = []
  contentLines.forEach((line, idx) => {
    if (line.type === 'added' || line.type === 'removed') {
      changedMarks.push({ pct: totalLines > 0 ? (idx / totalLines) * 100 : 0, type: line.type })
    }
  })

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current
    if (!el) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientY - rect.top) / rect.height
    el.scrollTop = pct * (el.scrollHeight - el.clientHeight)
  }

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Scrollable diff content */}
      <div ref={containerRef} className="diff-container" style={{ flex: 1, overflowY: 'auto', paddingRight: 16 }}>
        <div className="diff-file-header">📄 {filePath}</div>
        {hunks.map((hunk, hi) => (
          <div key={hi}>
            {hunk.map((line, li) => {
              if (line.type === 'hunk') {
                return (
                  <div key={li} className="diff-hunk-header">
                    {line.content}
                  </div>
                )
              }
              return (
                <div key={li} className={`diff-line ${line.type}`}>
                  <div className="diff-line-num">
                    {line.type === 'added' || line.type === 'context' ? line.lineNum : ''}
                  </div>
                  <div className="diff-line-content">
                    <span style={{
                      color: line.type === 'added' ? 'var(--success)'
                        : line.type === 'removed' ? 'var(--danger)'
                        : undefined,
                      marginRight: 8,
                      fontWeight: 700,
                      fontSize: 11
                    }}>
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    {line.content}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Scrollbar minimap overlay */}
      {changedMarks.length > 0 && (
        <div
          onClick={handleMinimapClick}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'pointer',
            zIndex: 20,
            backgroundColor: 'var(--bg2, rgba(0,0,0,0.08))',
            borderLeft: '1px solid var(--border, rgba(0,0,0,0.12))',
          }}
          title="Mapa de cambios — haz clic para navegar"
        >
          {/* Change marks */}
          {changedMarks.map((mark, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 1,
                right: 1,
                top: `${mark.pct}%`,
                height: 2,
                minHeight: 2,
                backgroundColor: mark.type === 'added'
                  ? 'var(--success, #3fb950)'
                  : 'var(--danger, #f85149)',
                borderRadius: 1,
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
