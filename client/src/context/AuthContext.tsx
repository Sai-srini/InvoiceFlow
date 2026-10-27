import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setAuthLostHandler } from '../lib/api';

export interface User { id: string; email: string; full_name: string; department: string | null; role: { id: string; name: string } | null; permissions: string[]; approval_limit_minor: number | null; approval_unlimited: boolean; }
interface Ctx {
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;      // holds ALL
  canAny: (...perms: string[]) => boolean;   // holds at least one
}
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthLostHandler(() => { setAccessToken(null); setUser(null); });
    refreshSession().then((b) => { if (b) setUser(b.user); }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const start = (b: any) => { setAccessToken(b.access_token); setUser(b.user); };
  const login = useCallback(async (email: string, password: string) => start(await api('/auth/login', { body: { email, password } })), []);
  const loginGoogle = useCallback(async (credential: string) => start(await api('/auth/google', { body: { credential } })), []);
  const acceptInvite = useCallback(async (token: string, password: string) => start(await api('/auth/accept-invite', { body: { token, password } })), []);
  const logout = useCallback(async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'invoiceflow', 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); } catch { /* ignore */ }
    setAccessToken(null); setUser(null);
  }, []);
  const value = useMemo<Ctx>(() => ({
    user, loading, login, loginGoogle, acceptInvite, logout,
    can: (...p) => !!user && p.every((x) => user.permissions.includes(x)),
    canAny: (...p) => !!user && p.some((x) => user.permissions.includes(x)),
  }), [user, loading, login, loginGoogle, acceptInvite, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const c = useContext(AuthContext); if (!c) throw new Error('useAuth outside provider'); return c; }
