import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Wraps routes that require authentication.
 * In local mode (no database configured), all routes are accessible.
 * When auth is enabled, unauthenticated users are redirected to /login.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, isLocalMode } = useAuth();

  if (loading) {
    return (
      <div className="h-screen bg-[#FAF9F6] flex items-center justify-center text-[#6B6960] text-sm">
        Loading...
      </div>
    );
  }

  // Local mode: always allow access
  if (isLocalMode) {
    return <>{children}</>;
  }

  // Auth mode: require login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
