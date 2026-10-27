import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Field, Modal, Page, Spinner, Tabs, useToast } from '../components/ui';
import { fmtDateTime, formatMinor, parseRupees, toRupeesInput } from '../lib/format';

function LinkBox({ link }: { link: string }) {
  return <Alert kind="warn"><b>Email is not configured, so share this link yourself (valid 7 days, single use):</b><div className="mono" style={{ wordBreak: 'break-all', margin: '6px 0' }}>{link}</div><Btn className="sm" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</Btn></Alert>;
}

function Users() {
  const toast = useToast(); const users = useApi<any>('/users?limit=100'); const roles = useApi<any[]>('/roles'); const [m, setM] = useState<any>(null); const [f, setF] = useState<any>({}); const [err, setErr] = useState(''); const [link, setLink] = useState('');
  const parse = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const invite = async () => { setErr(''); try { const r = await api('/users/invite', { body: { email: f.email, full_name: f.full_name, role_id: f.role_id, department: f.department || null, departments: parse(f.departments), cost_centres: parse(f.cost_centres),
    approval_unlimited: !!f.unlimited, approval_limit_minor: f.unlimited ? 0 : (parseRupees(f.limit) ?? 0) } }); if (r.delivery === 'manual') setLink(r.link); else { toast('Invitation emailed'); setM(null); } users.reload(); } catch (e) { setErr(errMsg(e)); } };
  const save = async () => { setErr(''); try { await api(`/users/${f.id}`, { method: 'PATCH', body: { full_name: f.full_name, role_id: f.role_id, department: f.department || null, departments: parse(f.departments), cost_centres: parse(f.cost_centres), approval_unlimited: !!f.unlimited, approval_limit_minor: f.unlimited ? 0 : (parseRupees(f.limit) ?? 0) } }); toast('Saved'); setM(null); users.reload(); } catch (e) { setErr(errMsg(e)); } };
  const edit = (u: any) => { setErr(''); setF({ id: u.id, full_name: u.full_name, role_id: u.role?.id, department: u.department || '', departments: u.departments.join(', '), cost_centres: u.cost_centres.join(', '), unlimited: u.approval_unlimited, limit: toRupeesInput(u.approval_limit_minor) }); setM('edit'); };
  const fields = <div className="form">
    {m === 'invite' && <><Field label="Email"><input type="email" value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></>}
    <Field label="Full name"><input value={f.full_name || ''} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
    <Field label="Role"><select value={f.role_id || ''} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Select…</option>{(roles.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    <Field label="Department"><input value={f.department || ''} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
    <Field label="Approval limit per invoice (₹)" hint="Only matters for roles that can approve. 0 means they cannot approve anything."><input inputMode="decimal" disabled={!!f.unlimited} value={f.limit || ''} onChange={(e) => setF({ ...f, limit: e.target.value })} /></Field>
    <label className="row"><input type="checkbox" checked={!!f.unlimited} onChange={(e) => setF({ ...f, unlimited: e.target.checked })} /> Unlimited approval limit</label>
    <Field label="Can approve only for departments" hint="Comma separated. Empty = all."><input value={f.departments || ''} onChange={(e) => setF({ ...f, departments: e.target.value })} /></Field>
    <Field label="Can approve only for cost centres" hint="Comma separated. Empty = all."><input value={f.cost_centres || ''} onChange={(e) => setF({ ...f, cost_centres: e.target.value })} /></Field></div>;
  return <>
    <Card title="People" actions={<Btn kind="primary" onClick={() => { setF({}); setErr(''); setLink(''); setM('invite'); }}>Invite user</Btn>} pad={false}>{users.loading ? <Spinner /> : users.error ? <Alert>{users.error}</Alert> : <div className="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Approval limit</th><th>Status</th><th>Last sign-in</th><th /></tr></thead><tbody>
      {users.data.data.map((u: any) => <tr key={u.id}><td><b>{u.full_name}</b><div className="muted">{u.email}</div></td><td>{u.role?.name}</td><td>{u.approval_unlimited ? 'Unlimited' : formatMinor(u.approval_limit_minor)}</td>
        <td>{u.pending_invitation ? <Badge status="pending" text="Invited" /> : u.is_active ? <Badge status="active" /> : <Badge status="inactive" />}{u.locked && <Badge status="rejected" text="Locked" />}</td><td>{fmtDateTime(u.last_login_at)}</td>
        <td><div className="row"><Btn className="sm" onClick={() => edit(u)}>Edit</Btn>
          <Btn className="sm" onClick={async () => { try { await api(`/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } }); users.reload(); } catch (e) { toast(errMsg(e), 'error'); } }}>{u.is_active ? 'Deactivate' : 'Reactivate'}</Btn>
          <Btn className="sm" onClick={async () => { try { const r = await api(`/users/${u.id}/reset-password`, { body: {} }); if (r.delivery === 'manual') { setLink(r.link); setM('link'); } else toast('Reset email sent'); } catch (e) { toast(errMsg(e), 'error'); } }}>Reset password</Btn>
          <Btn className="sm" onClick={async () => { try { await api(`/users/${u.id}/force-logout`, { body: {} }); toast('Signed out everywhere'); } catch (e) { toast(errMsg(e), 'error'); } }}>Sign out</Btn></div></td></tr>)}</tbody></table></div>}</Card>
    {m === 'invite' && <Modal wide title="Invite a user" onClose={() => setM(null)}>{fields}{err && <Alert>{err}</Alert>}{link && <LinkBox link={link} />}<div className="row end"><Btn onClick={() => setM(null)}>Close</Btn>{!link && <Btn kind="primary" onClick={invite}>Send invitation</Btn>}</div></Modal>}
    {m === 'edit' && <Modal wide title="Edit user" onClose={() => setM(null)}>{fields}{err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={() => setM(null)}>Cancel</Btn><Btn kind="primary" onClick={save}>Save</Btn></div></Modal>}
    {m === 'link' && <Modal title="Password reset link" onClose={() => { setM(null); setLink(''); }}><LinkBox link={link} /></Modal>}
  </>;
}

function Roles() {
  const toast = useToast(); const roles = useApi<any[]>('/roles'); const meta = useApi<any>('/meta/permissions'); const [m, setM] = useState<any>(null); const [f, setF] = useState<any>({ permissions: [] }); const [err, setErr] = useState('');
  const groups: Record<string, any[]> = {}; (meta.data?.permissions || []).forEach((p: any) => { (groups[p.key.split('.')[0]] ||= []).push(p); });
  const open = (r?: any) => { setErr(''); setF(r ? { id: r.id, name: r.name, description: r.description, permissions: [...r.permissions] } : { name: '', description: '', permissions: [] }); setM(true); };
  const save = async () => { setErr(''); try { await api(f.id ? `/roles/${f.id}` : '/roles', { method: f.id ? 'PATCH' : 'POST', body: { name: f.name, description: f.description, permissions: f.permissions } }); toast('Role saved. It applies immediately.'); setM(null); roles.reload(); } catch (e) { setErr(errMsg(e)); } };
  const toggle = (k: string) => setF({ ...f, permissions: f.permissions.includes(k) ? f.permissions.filter((x: string) => x !== k) : [...f.permissions, k] });
  return <>
    <Card title="Roles" actions={<Btn kind="primary" onClick={() => open()}>New role</Btn>} pad={false}>{roles.loading ? <Spinner /> : !roles.data?.length ? <Empty>No roles.</Empty> : <div className="scroll"><table><thead><tr><th>Role</th><th>People</th><th>Permissions</th><th /></tr></thead><tbody>
      {roles.data.map((r) => <tr key={r.id}><td><b>{r.name}</b><div className="muted">{r.description}</div></td><td>{r.user_count}</td><td className="muted">{r.permissions.length} permissions</td><td><div className="row"><Btn className="sm" onClick={() => open(r)}>Edit</Btn><Btn className="sm" kind="danger" onClick={async () => { if (confirm(`Delete role "${r.name}"?`)) { try { await api(`/roles/${r.id}`, { method: 'DELETE' }); roles.reload(); } catch (e) { toast(errMsg(e), 'error'); } } }}>Delete</Btn></div></td></tr>)}</tbody></table></div>}</Card>
    <Alert kind="info">Roles are just bundles of permissions. The Admin role deliberately has no financial permissions, so the person who manages users cannot move money. Avoid giving one role both preparing and releasing payments, or both creating and approving invoices.</Alert>
    {m && <Modal wide title={f.id ? 'Edit role' : 'New role'} onClose={() => setM(null)}><div className="form"><Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      {Object.entries(groups).map(([g, ps]) => <div className="perm-group" key={g}><h3>{g}</h3>{ps.map((p) => <label className="perm" key={p.key}><input type="checkbox" checked={f.permissions.includes(p.key)} onChange={() => toggle(p.key)} /><span><span className="mono">{p.key}</span> <span className="muted">{p.description}</span></span></label>)}</div>)}
      {err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={() => setM(null)}>Cancel</Btn><Btn kind="primary" onClick={save}>Save role</Btn></div></Modal>}
  </>;
}

function Delegations() {
  const { user } = useAuth(); const toast = useToast(); const list = useApi<any[]>('/delegations'); const approvers = useApi<any[]>('/users/approvers'); const [f, setF] = useState<any>({}); const [err, setErr] = useState('');
  const name = (id: string) => approvers.data?.find((a) => a.id === id)?.full_name || (id === user?.id ? 'You' : id.slice(-6));
  const create = async () => { setErr(''); try { await api('/delegations', { body: { to_user: f.to, starts_at: new Date(f.from).toISOString(), ends_at: new Date(f.until + 'T23:59:59').toISOString(), reason: f.reason || undefined } }); toast('Delegation created'); setF({}); list.reload(); } catch (e) { setErr(errMsg(e)); } };
  return <div className="grid g2"><Card title="Delegate my approvals while I'm away"><div className="form"><Field label="Delegate to"><select value={f.to || ''} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Select…</option>{(approvers.data || []).filter((a) => a.id !== user?.id).map((a) => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}</select></Field>
    <Field label="From"><input type="date" value={f.from || ''} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="Until"><input type="date" value={f.until || ''} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field><Field label="Reason"><input value={f.reason || ''} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
    <small className="muted">The delegate approves within their own limit, and every action records both of you.</small>{err && <Alert>{err}</Alert>}<div className="row end"><Btn kind="primary" disabled={!f.to || !f.from || !f.until} onClick={create}>Create</Btn></div></Card>
    <Card title="Active delegations" pad={false}>{!list.data?.length ? <Empty>None.</Empty> : <table><tbody>{list.data.map((d) => <tr key={d._id}><td>{name(String(d.from_user))} → {name(String(d.to_user))}<div className="muted">{fmtDateTime(d.starts_at)} to {fmtDateTime(d.ends_at)}</div></td>
      <td><Btn className="sm" onClick={async () => { try { await api(`/delegations/${d._id}`, { method: 'DELETE' }); list.reload(); } catch (e) { toast(errMsg(e), 'error'); } }}>Revoke</Btn></td></tr>)}</tbody></table>}</Card></div>;
}

export default function UsersRoles() {
  const { can, canAny } = useAuth(); const tabs = [...(can('user.manage') ? [{ key: 'users', label: 'People' }] : []), ...(can('role.manage') ? [{ key: 'roles', label: 'Roles & permissions' }] : []), ...(canAny('invoice.approve', 'user.manage') ? [{ key: 'del', label: 'Delegation' }] : [])];
  const [tab, setTab] = useState(tabs[0]?.key || 'users');
  return <Page title="Users & roles" sub="Invitation-only access"><Tabs value={tab} onChange={setTab} tabs={tabs} />{tab === 'users' && <Users />}{tab === 'roles' && <Roles />}{tab === 'del' && <Delegations />}</Page>;
}
