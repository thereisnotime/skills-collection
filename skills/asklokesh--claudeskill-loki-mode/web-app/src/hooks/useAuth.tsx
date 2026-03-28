import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  email: string;
  name: string;
  avatar_url: string;
  authenticated: boolean;
  local_mode?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (provider: 'github' | 'google') => void;
  logout: () => void;
  isLocalMode: boolean;
}

const TOKEN_KEY = 'pl_auth_token';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
  isLocalMode: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUserFromData(
  data: { authenticated: boolean; sub?: string; email?: string; name?: string; avatar?: string },
  setIsLocalMode: (v: boolean) => void,
  setUser: (u: User | null) => void,
) {
  setIsLocalMode(false);
  setUser({
    email: data.sub || data.email || '',
    name: data.name || '',
    avatar_url: data.avatar || '',
    authenticated: true,
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocalMode, setIsLocalMode] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Handle OAuth callback params in URL, then check auth status.
  // A single effect avoids race conditions between token extraction and
  // the /auth/me call.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // --- Step 1: extract token or code from URL query params -----------
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const code = params.get('code');

      if (token) {
        // Server-side OAuth redirect appended a token directly.
        localStorage.setItem(TOKEN_KEY, token);
        window.history.replaceState({}, '', window.location.pathname);
      } else if (code) {
        // OAuth provider redirected back with an authorization code.
        // Exchange it for a token via our backend.
        try {
          // Retrieve the provider and state from sessionStorage (set during login)
          const provider = sessionStorage.getItem('pl_oauth_provider') || 'github';
          const storedState = sessionStorage.getItem('pl_oauth_state') || '';
          // Clean up stored OAuth state immediately (single-use)
          sessionStorage.removeItem('pl_oauth_state');
          sessionStorage.removeItem('pl_oauth_provider');

          let result: { token: string; user: { email: string; name: string; avatar_url: string } };

          if (provider === 'google') {
            result = await api.googleCallback(code, storedState);
          } else {
            result = await api.githubCallback(code, storedState);
          }

          if (!cancelled) {
            localStorage.setItem(TOKEN_KEY, result.token);
            window.history.replaceState({}, '', window.location.pathname);
            setIsLocalMode(false);
            setUser({
              email: result.user.email,
              name: result.user.name,
              avatar_url: result.user.avatar_url,
              authenticated: true,
            });
            setLoading(false);
            return; // User is set, skip /auth/me call
          }
        } catch {
          // Code exchange failed -- fall through to normal auth check
          window.history.replaceState({}, '', window.location.pathname);
        }
      }

      // --- Step 2: verify auth status with the server --------------------
      try {
        const data = await api.getMe();
        if (cancelled) return;

        if (data.local_mode) {
          setIsLocalMode(true);
          setUser(null);
        } else if (data.authenticated) {
          setUserFromData(data, setIsLocalMode, setUser);
        } else {
          setIsLocalMode(false);
          setUser(null);
        }
      } catch {
        // If /api/auth/me fails, assume local mode
        if (cancelled) return;
        setIsLocalMode(true);
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback((provider: 'github' | 'google') => {
    if (provider === 'github') {
      api.getGitHubAuthUrl().then((data) => {
        // Extract state from the OAuth URL and store it with provider info
        // so the callback can pass it back for CSRF validation
        try {
          const url = new URL(data.url);
          const state = url.searchParams.get('state');
          if (state) {
            sessionStorage.setItem('pl_oauth_state', state);
            sessionStorage.setItem('pl_oauth_provider', 'github');
          }
        } catch { /* URL parsing failed, continue anyway */ }
        window.location.href = data.url;
      }).catch(() => {});
    } else if (provider === 'google') {
      api.getGoogleAuthUrl().then((data) => {
        try {
          const url = new URL(data.url);
          const state = url.searchParams.get('state');
          if (state) {
            sessionStorage.setItem('pl_oauth_state', state);
            sessionStorage.setItem('pl_oauth_provider', 'google');
          }
        } catch { /* URL parsing failed, continue anyway */ }
        window.location.href = data.url;
      }).catch(() => {});
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    // Only redirect if not already on the login page
    if (location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [navigate, location.pathname]);

  const value = useMemo(
    () => ({ user, loading, login, logout, isLocalMode }),
    [user, loading, login, logout, isLocalMode],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth() {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Token helper (used by API client)
// ---------------------------------------------------------------------------

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
