import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

/** Full-page loading indicator used while the session is validated. */
export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center-page" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{label}</p>
    </div>
  );
}

/**
 * Route guard. Redirects to /login when unauthenticated. When `adminOnly` is
 * set it renders a 403 message for volunteers instead of the child routes.
 */
export function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children?: ReactNode;
  adminOnly?: boolean;
}) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return <FullPageSpinner label="Checking your session…" />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (adminOnly && user.role !== 'admin') {
    return (
      <div className="card">
        <h2>Not allowed</h2>
        <p className="muted">
          This area is restricted to administrators. You are signed in as a {user.role}.
        </p>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
}
