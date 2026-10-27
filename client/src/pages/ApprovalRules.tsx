import { useState } from 'react';
import { api } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Field, Modal, Page, Spinner, useToast } from '../components/ui';
import { formatMinor, parseRupees, toRupeesInput } from '../lib/format';

const blank = { name: '', min: '0', max: '', department: '', cost_centre: '', vendor_category: '', approvers_required: '1', mode: 'sequential', escalation_hours: '24', priority: '0', is_active: true, role_ids: [] as string[], user_ids: [] as string[] };

export default function ApprovalRules() {
  const toast = useToast(); const rules = useApi<any[]>('/approval-rules'); const roles = useApi<any[]>('/roles'); const approvers = useApi<any[]>('/users/approvers');
  const [m, setM] = useState<any>(null); const [f, setF] = useState<any>(blank); const [err, setErr] = useState('');
  const open = (r?: any) => { setErr(''); setF(r ? { name: r.name, min: toRupeesInput(r.min_minor), max: r.max_minor === null ? '' : toRupeesInput(r.max_minor), department: r.department || '', cost_centre: r.cost_centre || '', vendor_category: r.vendor_category || '', approvers_required: String(r.approvers_required), mode: r.mode, escalation_hours: String(r.escalation_hours), priority: String(r.priority), is_active: r.is_active, role_ids: r.role_ids, user_ids: r.user_ids, id: r.id } : blank); setM(true); };
  const save = async () => { setErr(''); try { const body = { name: f.name, min_minor: parseRupees(f.min) ?? 0, max_minor: f.max === '' ? null : parseRupees(f.max), department: f.department || null, cost_centre: f.cost_centre || null, vendor_category: f.vendor_category || null,
    approvers_required: Number(f.approvers_required), mode: f.mode, role_ids: f.role_ids, user_ids: f.user_ids, escalation_hours: Number(f.escalation_hours), priority: Number(f.priority), is_active: f.is_active };
    await api(f.id ? `/approval-rules/${f.id}` : '/approval-rules', { method: f.id ? 'PUT' : 'POST', body }); toast('Rule saved'); setM(null); rules.reload(); } catch (e) { setErr(errMsg(e)); } };
  const toggle = (k: 'role_ids' | 'user_ids', id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x: string) => x !== id) : [...f[k], id] });
  const approverRoles = (roles.data || []).filter((r) => r.permissions.includes('invoice.approve'));
  return <Page title="Approval rules" sub="Who must approve, by amount and scope" actions={<Btn kind="primary" onClick={() => open()}>New rule</Btn>}>
    <Alert kind="info">The most specific matching rule is used (highest priority first). Every approver chosen must have an approval limit that covers the whole invoice amount, and can never be the person who created or edited it.</Alert>
    <Card pad={false}>{rules.loading ? <Spinner /> : !rules.data?.length ? <Empty>No rules yet. Invoices cannot be submitted until a rule matches.</Empty> : <div className="scroll"><table><thead><tr><th>Rule</th><th>Amount range</th><th>Scope</th><th>Approvers</th><th>Escalates</th><th>Priority</th><th /></tr></thead><tbody>
      {rules.data.map((r) => <tr key={r.id}><td><b>{r.name}</b> {!r.is_active && <Badge status="inactive" />}</td><td>{formatMinor(r.min_minor)} to {r.max_minor === null ? 'no limit' : formatMinor(r.max_minor)}</td><td>{[r.department, r.cost_centre, r.vendor_category].filter(Boolean).join(' · ') || 'Any'}</td>
        <td>{r.approvers_required} · {r.mode}</td><td>after {r.escalation_hours} h</td><td>{r.priority}</td><td><div className="row"><Btn className="sm" onClick={() => open(r)}>Edit</Btn><Btn className="sm" kind="danger" onClick={async () => { if (confirm(`Delete rule "${r.name}"?`)) { try { await api(`/approval-rules/${r.id}`, { method: 'DELETE' }); rules.reload(); } catch (e) { toast(errMsg(e), 'error'); } } }}>Delete</Btn></div></td></tr>)}</tbody></table></div>}</Card>
    {m && <Modal wide title={f.id ? 'Edit rule' : 'New rule'} onClose={() => setM(null)}><div className="form">
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="From amount (₹, inclusive)"><input inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field><Field label="Up to amount (₹, exclusive)" hint="Leave empty for no upper limit"><input inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
      <Field label="Department (optional)"><input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field><Field label="Cost centre (optional)"><input value={f.cost_centre} onChange={(e) => setF({ ...f, cost_centre: e.target.value })} /></Field><Field label="Vendor category (optional)"><input value={f.vendor_category} onChange={(e) => setF({ ...f, vendor_category: e.target.value })} /></Field>
      <Field label="Number of approvers"><select value={f.approvers_required} onChange={(e) => setF({ ...f, approvers_required: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field><Field label="Order"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="sequential">One after another</option><option value="parallel">All at once</option></select></Field>
      <Field label="Escalate after (hours)"><input inputMode="numeric" value={f.escalation_hours} onChange={(e) => setF({ ...f, escalation_hours: e.target.value })} /></Field><Field label="Priority" hint="Higher wins when several rules match"><input inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
      <label className="row"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>
      <Field label="Only these roles may approve (optional)" wide><div className="row">{approverRoles.map((r) => <label key={r.id} className="row"><input type="checkbox" checked={f.role_ids.includes(r.id)} onChange={() => toggle('role_ids', r.id)} />{r.name}</label>)}</div></Field>
      <Field label="Only these people may approve (optional)" wide><div className="row">{(approvers.data || []).map((u) => <label key={u.id} className="row"><input type="checkbox" checked={f.user_ids.includes(u.id)} onChange={() => toggle('user_ids', u.id)} />{u.full_name}</label>)}</div></Field></div>
      {err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={() => setM(null)}>Cancel</Btn><Btn kind="primary" onClick={save}>Save rule</Btn></div></Modal>}
  </Page>;
}
