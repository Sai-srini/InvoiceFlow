import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Alert, Btn, Field } from '../components/ui';
import { errMsg } from '../lib/hooks';

declare global { interface Window { google?: any; } }

export default function Login() {
  const { login, loginGoogle } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<{ google_enabled: boolean; google_client_id: string | null }>({ google_enabled: false, google_client_id: null });
  const gRef = useRef<HTMLDivElement>(null);
  useEffect(() => { api('/auth/config').then(setCfg).catch(() => undefined); }, []);
  useEffect(() => {
    if (!cfg.google_enabled || !cfg.google_client_id) return;
    const t = setInterval(() => {
      if (window.google?.accounts?.id && gRef.current) {
        clearInterval(t);
        window.google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: async (r: any) => { try { await loginGoogle(r.credential); } catch (e) { setErr(errMsg(e)); } } });
        window.google.accounts.id.renderButton(gRef.current, { theme: 'outline', size: 'large', width: 340 });
      }
    }, 300);
    return () => clearInterval(t);
  }, [cfg, loginGoogle]);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(email, password); } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); } };
  return <div className="login"><div className="card"><div className="card-b">
    <div className="brand" style={{ color: 'var(--ink)', marginBottom: 14 }}><i style={{ color: '#fff' }}>IF</i>InvoiceFlow</div>
    <h1 style={{ fontSize: 22, marginBottom: 4 }}>Sign in</h1><p className="muted" style={{ marginTop: 0 }}>Accounts payable for your team. Access is by invitation only.</p>
    <form onSubmit={submit} className="grid">
      <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {err && <Alert>{err}</Alert>}
      <Btn kind="primary" type="submit" busy={busy}>Sign in</Btn>
    </form>
    {cfg.google_enabled && <><div className="muted" style={{ textAlign: 'center', margin: '14px 0' }}>or</div><div ref={gRef} /><small className="muted">Google sign-in works only for accounts that were already invited.</small></>}
  </div></div></div>;
}
