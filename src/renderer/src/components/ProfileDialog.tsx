import { useState } from 'react'

interface Props {
  currentUsername: string
  currentServerUrl: string
  onSave: (creds: { username: string; password: string; serverUrl: string }) => void
  onCancel: () => void
  authError?: boolean
}

export default function ProfileDialog({ currentUsername, currentServerUrl, onSave, onCancel, authError = false }: Props) {
  const [username, setUsername] = useState(currentUsername)
  const [password, setPassword] = useState('')
  const [serverUrl, setServerUrl] = useState(currentServerUrl)
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.svn.pingWithCreds({ url: serverUrl, username, password })
      if (result.ok) {
        setTestResult({ ok: true, msg: 'Conexion exitosa ✓' })
      } else {
        setTestResult({ ok: false, msg: result.message || 'Error de conexion' })
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message || 'Error' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    if (!username.trim()) return

    const creds = { username: username.trim(), password, serverUrl: serverUrl.trim() }
    void onSave(creds)

    // Do not retain the SVN password in renderer component or parent state after handing it to IPC.
    creds.password = ''
    setPassword('')
    setShowPassword(false)
  }

  return (
    <div className="overlay">
      <div className="dialog" style={{ width: 420 }}>
        <div className="dialog-title">
          {authError ? '🔐 Credenciales invalidas' : '👤 Perfil de usuario'}
        </div>
        <div className="dialog-sub">
          {authError
            ? 'Tu contrasena puede haber cambiado. Actualiza tus credenciales para continuar.'
            : 'Actualiza tus credenciales de acceso al servidor SVN'}
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
          <div style={{ position: 'relative' }}>
            <input
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              style={{ paddingRight: 70 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text3)',
                fontSize: 11,
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4
              }}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Deja en blanco para mantener la contraseña actual
          </div>
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
            {testing ? 'Probando...' : 'Probar conexion'}
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
