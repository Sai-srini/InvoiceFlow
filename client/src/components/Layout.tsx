import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Btn, Field, Modal, Alert, useToast } from './ui';
import { fmtDateTime } from '../lib/format';
import { errMsg } from '../lib/hooks';

const NAV: { to: string; label: string; any?: string[] }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/approvals', label: 'Approvals', any: ['invoice.approve', 'invoice.reject', 'invoice.hold'] },
  { to: '/invoices', label: 'Invoices', any: ['invoice.view_all', 'invoice.view_own', 'invoice.view_assigned', 'invoice.create', 'invoice.create_own'] },
  { to: '/intake', label: 'Invoice intake', any: ['invoice.upload', 'invoice.review_extraction'] },
  { to: '/vendors', label: 'Vendors', any: ['vendor.view'] },
  { to: '/payment-runs', label: 'Payment runs', any: ['payment.view'] },
  { to: '/reconciliation', label: 'Reconciliation', any: ['bank.view'] },
  { to: '/reports', label: 'Reports', any: ['report.view_own', 'report.view_ops', 'report.view_all'] },
  { to: '/approval-rules', label: 'Approval rules', any: ['rules.manage'] },
  { to: '/users', label: 'Users & roles', any: ['user.manage', 'role.manage'] },
  { to: '/settings', label: 'Settings', any: ['org.settings', 'tax.configure', 'bank.configure'] },
  { to: '/audit', label: 'Audit log', any: ['audit.view'] },
];

/** Where a notification should take the user, derived from what it points at. */
function entityRoute(n: any): string | null {
  const id = n.entity_id ? String(n.entity_id) : '';
  if (!id) return null;
  if (n.entity_type === 'Invoice') return `/invoices/${id}`;
  if (n.entity_type === 'PaymentRun') return `/payment-runs/${id}`;
  if (n.entity_type === 'Vendor') return `/vendors?id=${id}`;
  return null;
}

function Bell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false); const [data, setData] = useState<any>({ data: [], unread: 0 });
  const load = () => api('/notifications').then(setData).catch(() => undefined);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const toggle = async () => { setOpen(!open); if (!open && data.unread) { await api('/notifications/read', { body: {} }); setTimeout(load, 800); } };
  return <div className="bell"><Btn onClick={toggle} aria-label="Notifications">Notifications</Btn>{data.unread > 0 && <span className="n">{data.unread}</span>}
    {open && <div className="menu">{data.data.length === 0 ? <div className="item muted">Nothing yet.</div> : data.data.map((n: any) => {
      const content = <><b>{n.title}</b><div className="muted">{n.body}</div><small className="muted">{fmtDateTime(n.createdAt)}{n.email_state === 'undelivered' ? ' · email not sent' : ''}</small></>;
      const to = entityRoute(n);
      return to
        ? <button type="button" className="item clickable" key={n._id} onClick={() => { setOpen(false); nav(to); }}>{content}<span className="go" aria-hidden="true">Open →</span></button>
        : <div className="item" key={n._id}>{content}</div>;
    })}</div>}</div>;
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [err, setErr] = useState(''); const toast = useToast(); const { logout } = useAuth();
  const go = async () => { try { await api('/auth/change-password', { body: { current_password: cur, new_password: next } }); toast('Password changed. Please sign in again.'); await logout(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal title="Change password" onClose={onClose}><div className="form"><Field label="Current password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
    <Field label="New password" hint="At least 10 characters with upper and lower case, a number and a symbol."><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field></div>
    {err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={go}>Change password</Btn></div></Modal>;
}

export default function Layout() {
  const { user, canAny, logout } = useAuth(); const nav = useNavigate(); const [pw, setPw] = useState(false);
  const [org, setOrg] = useState('');
  useEffect(() => { api('/settings').then((s) => setOrg(s.name)).catch(() => undefined); }, []);
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><i>IF</i>InvoiceFlow</div>
        <div className="org"><small>Organisation</small><b>{org || '…'}</b></div>
        <nav className="nav" aria-label="Main">{NAV.filter((n) => !n.any || canAny(...n.any)).map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{n.label}</NavLink>)}</nav>
        <div className="me"><b>{user?.full_name}</b>{user?.role?.name}</div>
      </aside>
      <div className="main">
        <div className="top"><Bell /><Btn onClick={() => setPw(true)}>Password</Btn><Btn onClick={async () => { await logout(); nav('/'); }}>Sign out</Btn></div>
        <Outlet />
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}
