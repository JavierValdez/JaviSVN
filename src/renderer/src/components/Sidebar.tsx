import { LocalRepo, RemoteServer } from '../types/svn'

interface Props {
  repos: LocalRepo[]
  remotes: RemoteServer[]
  selectedRepo: LocalRepo | null
  isExplorerActive: boolean
  activeRemoteId: string | null
  onSelectRepo: (repo: LocalRepo) => void
  onSelectRemote: (remoteId: string) => void
  onOpenExplorer: () => void
  onRefresh: () => void
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  return `hace ${Math.floor(diff / 86400)} días`
}

export default function Sidebar({
  repos,
  remotes,
  selectedRepo,
  isExplorerActive,
  activeRemoteId,
  onSelectRepo,
  onSelectRemote,
  onOpenExplorer,
  onRefresh
}: Props) {
  return (
    <div className="sidebar">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo">S</div>
        <div className="sidebar-appname">JaviSVN</div>
      </div>

      {/* Repos section */}
      <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
        <div className="sidebar-section-title">
          Repositorios locales
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 6px', fontSize: 11, marginLeft: 4 }}
            onClick={onRefresh}
            title="Actualizar lista"
          >
            ⟳
          </button>
        </div>

        {repos.length === 0 ? (
          <div style={{ padding: '12px', fontSize: 12, color: 'var(--sidebar-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Sin repositorios locales.{'\n'}Explora el servidor para descargar.
          </div>
        ) : (
          repos.map((repo) => (
            <div
              key={repo.path}
              className={`sidebar-item ${selectedRepo?.path === repo.path ? 'active' : ''}`}
              onClick={() => onSelectRepo(repo)}
            >
              <div className="sidebar-item-icon">📁</div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-name">{repo.name}</div>
                <div className="sidebar-item-sub">r{repo.revision} · {timeAgo(repo.lastUpdated)}</div>
              </div>
              {repo.changesCount > 0 && (
                <span className="sidebar-badge">{repo.changesCount}</span>
              )}
            </div>
          ))
        )}

        <div className="sidebar-section-title" style={{ marginTop: 12 }}>
          Repositorios remotos
        </div>
        {remotes.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--sidebar-muted)' }}>
            Sin remotos guardados
          </div>
        ) : (
          remotes.map((remote) => (
            <div
              key={remote.id}
              className={`sidebar-item ${(isExplorerActive && activeRemoteId === remote.id) ? 'active' : ''}`}
              onClick={() => onSelectRemote(remote.id)}
              title={remote.url}
            >
              <div className="sidebar-item-icon">🌐</div>
              <div className="sidebar-item-info">
                <div className="sidebar-item-name">{remote.name}</div>
                <div className="sidebar-item-sub">{remote.url}</div>
              </div>
            </div>
          ))
        )}
        <div
          className={`sidebar-item ${isExplorerActive && !activeRemoteId ? 'active' : ''}`}
          onClick={onOpenExplorer}
        >
          <div className="sidebar-item-icon">🔍</div>
          <div className="sidebar-item-info">
            <div className="sidebar-item-name">Explorar servidor SVN</div>
            <div className="sidebar-item-sub">Vista remota</div>
          </div>
        </div>
      </div>
    </div>
  )
}
