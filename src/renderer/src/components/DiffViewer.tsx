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

  return (
    <div className="diff-container">
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
  )
}
