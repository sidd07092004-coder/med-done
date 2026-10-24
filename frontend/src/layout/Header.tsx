import { useAuth } from '../auth/AuthContext';

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <button
        type="button"
        className="icon-btn sidebar-toggle"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <span aria-hidden="true">☰</span>
      </button>

      <div className="brand">
        <b>Medically Complicated</b>
        <span>Site admin</span>
      </div>

      <div className="header-spacer" />

      {user && (
        <div className="header-user">
          <span className="who">
            <strong>{user.name}</strong>
            <span className={`role-badge role-${user.role}`}>{user.role}</span>
          </span>
          <button type="button" className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
