import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  fetchMe,
  getToken,
  login as apiLogin,
  setToken,
  setUnauthorizedHandler,
} from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  /** True while the stored token is being validated on first load. */
  initializing: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [initializing, setInitializing] = useState<boolean>(() => Boolean(getToken()));
  const queryClient = useQueryClient();

  const clear = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  // Any 401 from the API clears the session; ProtectedRoute then redirects.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setTokenState(null);
      setUser(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  // Validate an existing token once on mount. (Runs twice under StrictMode in
  // dev; the effect-local `cancelled` flag makes that harmless.)
  useEffect(() => {
    const existing = getToken();
    if (!existing) {
      setInitializing(false);
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setInitializing(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // 401 already cleared the token via the unauthorized handler.
        if (!(err instanceof ApiError) || err.status !== 401) clear();
        setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const res = await apiLogin(email, password);
      setToken(res.access_token);
      setTokenState(res.access_token);
      let me = res.user ?? null;
      if (!me) me = await fetchMe();
      setUser(me);
      return me;
    },
    [],
  );

  const logout = useCallback(() => {
    clear();
    queryClient.clear();
  }, [clear, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      initializing,
      isAdmin: user?.role === 'admin',
      login,
      logout,
    }),
    [user, token, initializing, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
