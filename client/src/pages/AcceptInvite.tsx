import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Btn, Field } from '../components/ui';
import { errMsg } from '../lib/hooks';

export default function AcceptInvite() {
  const [q] = useSearchParams(); const { acceptInvite } = useAuth(); const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const token = q.get('token') || '';
  const submit = async (e: FormEvent) => { e.preventDefault(); if (pw !== pw2) return setErr('Passwords do not match.'); setBusy(true); setErr('');
    try { await acceptInvite(token, pw); nav('/'); } catch (e2) { setErr(errMsg(e2)); setBusy(false); } };
  return <div className="login"><div className="card"><div className="card-b"><h1 style={{ fontSize: 22 }}>Set your password</h1>
    {!token ? <Alert>This link is missing its token. Ask your administrator for a new invitation.</Alert> : <form onSubmit={submit} className="grid">
      <Field label="New password" hint="At least 10 characters with upper and lower case, a number and a symbol."><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
      <Field label="Repeat password"><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      {err && <Alert>{err}</Alert>}<Btn kind="primary" type="submit" busy={busy}>Save and sign in</Btn></form>}
  </div></div></div>;
}
