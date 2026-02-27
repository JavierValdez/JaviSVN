import { useState } from 'react'

interface Props {
  onSave: (creds: { username: string; password: string; serverUrl: string }) => void
  onCancel: () => void
  initialServerUrl?: string
}

export default function AuthDialog({ onSave, onCancel, initialServerUrl = '' }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.svn.pingWithCreds({ url: serverUrl, username, password })
      if (result.ok) {
        setTestResult({ ok: true, msg: 'Conexión exitosa ✓' })
      } else {
        setTestResult({ ok: false, msg: result.message || 'Error de conexión' })
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message || 'Error' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    if (!username.trim()) return
    onSave({ username: username.trim(), password, serverUrl: serverUrl.trim() })
  }

  return (
    <div className="overlay">
      <div className="dialog">
        <div className="dialog-title">🔐 Conectar al servidor SVN</div>
        <div className="dialog-sub">
          Ingresa tus credenciales para acceder al repositorio SVN interno
        </div>

        <div className="form-field">
          <label className="form-label">URL del servidor</label>
          <input
            className="form-input"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://servidor/svn"
          />
        </div>

        <div className="form-field">
          <label className="form-label">Usuario</label>
          <input
            className="form-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="tu.usuario"
            autoFocus
          />
        </div>

        <div className="form-field">
          <label className="form-label">Contraseña</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          />
        </div>

        {testResult && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: testResult.ok ? '#dafbe1' : '#ffebe9',
            color: testResult.ok ? 'var(--success)' : 'var(--danger)',
            fontSize: 12,
            marginBottom: 8
          }}>
            {testResult.msg}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={handleTest} disabled={testing || !username || !serverUrl}>
            {testing ? 'Probando...' : 'Probar conexión'}
          </button>
          <button className="btn btn-default" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!username.trim()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
