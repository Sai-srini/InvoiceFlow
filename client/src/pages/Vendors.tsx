import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { fmtDate, formatMinor, label } from '../lib/format';
import { Alert, Badge, Btn, Card, Drawer, Empty, Field, Modal, Page, Pager, ReasonModal, Spinner, useToast } from '../components/ui';

/* ---------- validation (the server checks again; this only saves a round trip) ---------- */
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Form = Record<string, string>;
const blank: Form = { name: '', gstin: '', pan: '', category: '', payment_terms_days: '30', tds_section: '', contact_name: '', contact_email: '', contact_phone: '', address: '',
  account_name: '', account_number: '', ifsc: '', bank_name: '', reason: '' };

function validate(f: Form, o: { bank: boolean; identity: boolean }): Form {
  const e: Form = {};
  if (o.identity) {
    if (f.name.trim().length < 2) e.name = 'Enter the vendor\'s legal name.';
    if (f.gstin && !GSTIN.test(f.gstin)) e.gstin = 'GSTIN is 15 characters, for example 33AABCU9603R1ZX.';
    if (f.pan && !PAN.test(f.pan)) e.pan = 'PAN is 5 letters, 4 digits, 1 letter.';
    const t = Number(f.payment_terms_days); if (!Number.isInteger(t) || t < 0 || t > 365) e.payment_terms_days = 'Use whole days from 0 to 365.';
  }
  if (f.contact_email && !EMAIL.test(f.contact_email)) e.contact_email = 'This does not look like an e-mail address.';
  if (o.bank && (f.account_number || f.ifsc || f.account_name)) {
    if (f.account_name.trim().length < 2) e.account_name = 'Enter the name on the bank account.';
    if (!/^\d{6,20}$/.test(f.account_number.replace(/\s/g, ''))) e.account_number = 'Account number is 6 to 20 digits.';
    if (!IFSC.test(f.ifsc)) e.ifsc = 'IFSC is 4 letters, a zero, then 6 letters or digits.';
  }
  return e;
}

const fromVendor = (v: any): Form => ({ ...blank, name: v.name || '', gstin: v.gstin || '', pan: v.pan || '', category: v.category || '', payment_terms_days: String(v.payment_terms_days ?? 30),
  tds_section: v.tds_section || '', contact_name: v.contact_name || '', contact_email: v.contact_email || '', contact_phone: v.contact_phone || '', address: v.address || '' });

/* ---------- the form used for "Propose vendor" and "Edit vendor" ---------- */
function VendorFields({ f, set, err, mode, canIdentity }: { f: Form; set: (k: string, x: string) => void; err: Form; mode: 'new' | 'edit'; canIdentity: boolean }) {
  const lock = !canIdentity;
  const text = (k: string, upper = false, extra: object = {}) => ({ value: f[k], onChange: (e: any) => set(k, upper ? e.target.value.toUpperCase() : e.target.value), 'aria-invalid': !!err[k], ...extra });
  return <div className="form">
    <h3>Identity and tax</h3>
    <Field label="Legal name" error={err.name}><input {...text('name', false, { disabled: lock, autoFocus: mode === 'new' })} /></Field>
    <Field label="GSTIN" error={err.gstin} hint={lock ? undefined : 'Optional. The check digit is verified.'}><input {...text('gstin', true, { disabled: lock, maxLength: 15 })} /></Field>
    <Field label="PAN" error={err.pan}><input {...text('pan', true, { disabled: lock, maxLength: 10 })} /></Field>
    <Field label="Category"><input {...text('category', false, { disabled: lock })} /></Field>
    <Field label="Payment terms (days)" error={err.payment_terms_days}><input {...text('payment_terms_days', false, { disabled: lock, inputMode: 'numeric' })} /></Field>
    <Field label="TDS section" hint="As configured in Settings"><input {...text('tds_section', true, { disabled: lock })} /></Field>
    {lock && <div className="field wide"><small>Changing name, tax identifiers, terms or TDS needs the “approve vendors” permission. Contact details can still be edited.</small></div>}
    <h3>Contact</h3>
    <Field label="Contact name"><input {...text('contact_name')} /></Field>
    <Field label="E-mail" error={err.contact_email}><input type="email" {...text('contact_email')} /></Field>
    <Field label="Phone"><input {...text('contact_phone')} /></Field>
    <Field label="Address" wide><input {...text('address')} /></Field>
  </div>;
}
function BankFields({ f, set, err }: { f: Form; set: (k: string, x: string) => void; err: Form }) {
  return <div className="form">
    <h3>Bank account</h3>
    <Field label="Account holder name" error={err.account_name}><input value={f.account_name} onChange={(e) => set('account_name', e.target.value)} aria-invalid={!!err.account_name} /></Field>
    <Field label="Account number" error={err.account_number}><input inputMode="numeric" autoComplete="off" value={f.account_number} onChange={(e) => set('account_number', e.target.value)} aria-invalid={!!err.account_number} /></Field>
    <Field label="IFSC" error={err.ifsc}><input value={f.ifsc} maxLength={11} onChange={(e) => set('ifsc', e.target.value.toUpperCase())} aria-invalid={!!err.ifsc} /></Field>
    <Field label="Bank name"><input value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></Field>
  </div>;
}

const FILTERS: { key: string; label: string }[] = [{ key: '', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'pending_approval', label: 'Awaiting approval' }, { key: 'inactive', label: 'Inactive' }, { key: 'rejected', label: 'Rejected' }];

type ModalState = null | { kind: 'new' } | { kind: 'edit'; v: any } | { kind: 'bank'; v: any } | { kind: 'reject'; type: 'vendor' | 'bank'; id: string } | { kind: 'reveal'; v: any; data: any | null } | { kind: 'toggle'; v: any };

export default function Vendors() {
  const { can, user } = useAuth(); const toast = useToast();
  const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [qInput, setQInput] = useState('');
  const list = useApi<any>(`/vendors?page=${page}&limit=25${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const changes = useApi<any[]>(can('vendor.bank_change.approve') ? '/vendors/bank-changes' : null);
  const [params, setParams] = useSearchParams();
  const [openId, setOpenIdRaw] = useState<string | null>(params.get('id'));
  const openVendor = (id: string) => { setParams({ id }, { replace: true }); setOpenIdRaw(id); };  // so a click here is linkable and the closed state clears the URL
  const closeVendor = () => { setParams({}, { replace: true }); setOpenIdRaw(null); };
  const setOpenId = openVendor; // row clicks keep one code path and stay deep-linkable
  const detail = useApi<any>(openId ? `/vendors/${openId}` : null);
  const [modal, setModal] = useState<ModalState>(null); const [f, setF] = useState<Form>(blank); const [err, setErr] = useState<Form>({}); const [formErr, setFormErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, x: string) => { setF((s) => ({ ...s, [k]: x })); setErr((s) => (s[k] ? { ...s, [k]: '' } : s)); };
  const reloadAll = () => { list.reload(); changes.reload(); if (openId) detail.reload(); };
  const close = () => { setModal(null); setFormErr(''); setErr({}); setBusy(false); };

  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); reloadAll(); } catch (e) { toast(errMsg(e), 'error'); } };
  const search = (e: FormEvent) => { e.preventDefault(); setQ(qInput.trim()); setPage(1); };

  const openNew = () => { setF(blank); setErr({}); setFormErr(''); setModal({ kind: 'new' }); };
  const openEdit = (v: any) => { setF(fromVendor(v)); setErr({}); setFormErr(''); setModal({ kind: 'edit', v }); };
  const openBank = (v: any) => { setF({ ...blank, account_name: v.name }); setErr({}); setFormErr(''); setModal({ kind: 'bank', v }); };

  const submit = async (fn: () => Promise<any>, problems: Form, ok: string) => {
    if (Object.values(problems).some(Boolean)) { setErr(problems); setFormErr('Please fix the highlighted fields.'); return; }
    setBusy(true); setFormErr('');
    try { await fn(); toast(ok); close(); reloadAll(); } catch (e) { setFormErr(errMsg(e)); setBusy(false); }
  };
  const bankBody = () => ({ account_name: f.account_name.trim(), account_number: f.account_number.replace(/\s/g, ''), ifsc: f.ifsc, bank_name: f.bank_name || undefined });
  const propose = () => submit(() => api('/vendors', { body: { name: f.name.trim(), gstin: f.gstin || null, pan: f.pan || null, category: f.category || null, payment_terms_days: Number(f.payment_terms_days),
    tds_section: f.tds_section || null, contact_name: f.contact_name || undefined, contact_email: f.contact_email || undefined, contact_phone: f.contact_phone || undefined, address: f.address || undefined,
    bank: f.account_number ? bankBody() : undefined } }), validate(f, { bank: true, identity: true }), 'Vendor proposed. A different person must approve it before it can be paid.');
  const saveEdit = () => { const v = (modal as any).v; const ident = can('vendor.approve');
    const body: any = { contact_name: f.contact_name, contact_email: f.contact_email, contact_phone: f.contact_phone, address: f.address };
    if (ident) Object.assign(body, { name: f.name.trim(), gstin: f.gstin || null, pan: f.pan || null, category: f.category || null, payment_terms_days: Number(f.payment_terms_days), tds_section: f.tds_section || null });
    return submit(() => api(`/vendors/${v.id}`, { method: 'PATCH', body }), validate(f, { bank: false, identity: ident }), 'Vendor updated.'); };
  const changeBank = () => { const v = (modal as any).v; const p = validate({ ...f, account_name: f.account_name || '' }, { bank: true, identity: false });
    if (!f.account_number) p.account_number = 'Enter the new account number.'; if (f.reason.trim().length < 5) p.reason = 'Write at least 5 characters.';
    return submit(() => api(`/vendors/${v.id}/bank-changes`, { body: { reason: f.reason.trim(), bank: bankBody() } }), p, 'Bank change proposed. A second person must approve it.'); };
  const reveal = async (v: any) => { setModal({ kind: 'reveal', v, data: null }); };
  const confirmReveal = async () => { const m = modal as any; try { const data = await api(`/vendors/${m.v.id}/reveal-bank`, { body: {} }); setModal({ ...m, data }); } catch (e) { toast(errMsg(e), 'error'); close(); } };
  const toggle = async () => { const v = (modal as any).v; const next = v.status === 'active' ? 'inactive' : 'active';
    try { await api(`/vendors/${v.id}`, { method: 'PATCH', body: { status: next } }); toast(next === 'inactive' ? 'Vendor deactivated. It can no longer be paid.' : 'Vendor reactivated.'); close(); reloadAll(); } catch (e) { toast(errMsg(e), 'error'); close(); } };

  const mine = (v: any) => v.proposed_by && user && v.proposed_by === user.id;
  const approveBtn = (v: any, sm = true) => can('vendor.approve') && v.status === 'pending_approval' && <>
    <Btn kind="primary" className={sm ? 'sm' : ''} disabled={mine(v)} title={mine(v) ? 'You proposed this vendor, so someone else must approve it.' : undefined}
      onClick={() => act(() => api(`/vendors/${v.id}/approve`, { body: {} }), 'Vendor approved')}>Approve</Btn>
    <Btn kind="danger" className={sm ? 'sm' : ''} disabled={mine(v)} onClick={() => setModal({ kind: 'reject', type: 'vendor', id: v.id })}>Reject</Btn></>;

  const counts = list.data?.counts || {}; const total = Object.values(counts).reduce((a: number, b: any) => a + Number(b), 0);
  const d = detail.data;
  return <Page title="Vendors" sub="Vendor master" actions={can('vendor.propose') && <Btn kind="primary" onClick={openNew}>Propose vendor</Btn>}>
    {changes.data && changes.data.length > 0 && <Card title={`Bank detail changes waiting for approval (${changes.data.length})`} pad={false}><div className="scroll"><table><thead><tr><th>Vendor</th><th>Current</th><th>Proposed</th><th>Reason</th><th /></tr></thead><tbody>
      {changes.data.map((c) => <tr key={c.id}><td><b>{c.vendor_name}</b></td><td className="mono">{c.current ? `${c.current.account_masked} · ${c.current.ifsc}` : '—'}</td>
        <td className="mono">{c.proposed.account_masked} · {c.proposed.ifsc}<div className="muted">{c.proposed.account_name}</div></td><td>{c.reason}</td>
        <td><div className="row"><Btn kind="primary" className="sm" disabled={c.proposed_by === user?.id} title={c.proposed_by === user?.id ? 'You proposed this change, so someone else must approve it.' : undefined}
          onClick={() => act(() => api(`/vendors/bank-changes/${c.id}/approve`, { body: {} }), 'Bank change approved')}>Approve</Btn>
          <Btn kind="danger" className="sm" disabled={c.proposed_by === user?.id} onClick={() => setModal({ kind: 'reject', type: 'bank', id: c.id })}>Reject</Btn></div></td></tr>)}</tbody></table></div>
      <div className="card-b"><small className="muted">Check these details with the vendor by phone before approving. Bank changes are the most common payment-fraud route.</small></div></Card>}

    <Card pad={false}>
      <div className="row" style={{ justifyContent: 'space-between', padding: '16px 0' }}>
        <div className="chips" role="group" aria-label="Filter by status">{FILTERS.map((x) => <button key={x.key} className={`chip ${status === x.key ? 'on' : ''}`} aria-pressed={status === x.key}
          onClick={() => { setStatus(x.key); setPage(1); }}>{x.label}<small>{x.key ? counts[x.key] ?? 0 : total}</small></button>)}</div>
        <form className="row" onSubmit={search} role="search"><input style={{ width: 240 }} placeholder="Search by vendor name" aria-label="Search vendors" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          <Btn type="submit">Search</Btn>{q && <Btn type="button" onClick={() => { setQ(''); setQInput(''); setPage(1); }}>Clear</Btn>}</form></div>
      {list.loading && !list.data ? <Spinner /> : list.error ? <Alert>{list.error}</Alert> : list.data.data.length === 0
        ? <Empty>{q || status ? 'No vendors match this search.' : 'No vendors yet. Propose the first one.'}</Empty>
        : <div className="scroll"><table><thead><tr><th>Name</th><th>GSTIN</th><th>Terms</th><th>Status</th><th>Bank</th><th>TDS</th><th /></tr></thead><tbody>
          {list.data.data.map((v: any) => <tr key={v.id} className={`click ${openId === v.id ? 'sel' : ''}`} onClick={() => setOpenId(v.id)}>
            <td><button className="link" style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); setOpenId(v.id); }} aria-label={`Open ${v.name}`}>{v.name}</button><div className="muted">{v.category || ''}</div></td>
            <td className="mono">{v.gstin || '—'}</td><td className="num" style={{ textAlign: 'left' }}>{v.payment_terms_days} d</td><td><Badge status={v.status} /></td>
            <td className="mono">{v.bank ? `${v.bank.account_masked} · ${v.bank.ifsc}` : <span className="muted">none</span>}</td><td>{v.tds_section || '—'}</td>
            <td onClick={(e) => e.stopPropagation()}><div className="row">{approveBtn(v)}{v.status !== 'pending_approval' && <Btn className="sm" onClick={() => setOpenId(v.id)}>View</Btn>}</div></td></tr>)}</tbody></table></div>}
      {list.data && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}</Card>

    {openId && <Drawer title={d?.name || 'Vendor'} sub={d ? `Vendor · ${label(d.status)}` : 'Vendor'} onClose={closeVendor}>
      {detail.loading && !d ? <Spinner /> : detail.error ? <Alert>{detail.error}</Alert> : d && <>
        {d.status === 'rejected' && d.rejection_reason && <Alert>Rejected: {d.rejection_reason}</Alert>}
        {d.status === 'pending_approval' && <Alert kind="warn">Waiting for approval. This vendor cannot be paid yet.</Alert>}
        <div className="kpis"><div className="stat"><div className="eyebrow">Invoices</div><b>{d.stats?.invoice_count ?? 0}</b></div>
          <div className="stat hot"><div className="eyebrow">Open payable</div><b style={{ fontSize: 22 }}>{formatMinor(d.stats?.open_minor ?? 0)}</b></div>
          <div className="stat"><div className="eyebrow">Paid</div><b style={{ fontSize: 22 }}>{formatMinor(d.stats?.paid_minor ?? 0)}</b></div></div>
        <dl className="kv"><dt>GSTIN</dt><dd className="mono">{d.gstin || '—'}</dd><dt>PAN</dt><dd className="mono">{d.pan || '—'}</dd><dt>Category</dt><dd>{d.category || '—'}</dd>
          <dt>Terms</dt><dd>{d.payment_terms_days} days</dd><dt>TDS section</dt><dd>{d.tds_section || '—'}</dd><dt>Contact</dt><dd>{d.contact_name || '—'}</dd>
          <dt>E-mail</dt><dd>{d.contact_email || '—'}</dd><dt>Phone</dt><dd>{d.contact_phone || '—'}</dd><dt>Address</dt><dd>{d.address || '—'}</dd>
          <dt>Bank</dt><dd className="mono">{d.bank ? <>{d.bank.account_masked} · {d.bank.ifsc}<div className="muted">{d.bank.account_name}{d.bank.bank_name ? ` · ${d.bank.bank_name}` : ''}</div></> : <span className="muted">none on file</span>}</dd>
          <dt>Last invoice</dt><dd>{fmtDate(d.stats?.last_invoice_date)}</dd><dt>Added</dt><dd>{fmtDate(d.createdAt)}</dd></dl>
        <div className="row">
          {approveBtn(d, false)}
          {['active', 'inactive'].includes(d.status) && (can('vendor.propose') || can('vendor.approve')) && <Btn onClick={() => openEdit(d)}>Edit details</Btn>}
          {d.status === 'active' && can('vendor.bank_change.propose') && <Btn onClick={() => openBank(d)}>Change bank</Btn>}
          {d.status === 'pending_approval' && can('vendor.propose') && <Btn onClick={() => openEdit(d)}>Edit details</Btn>}
          {['active', 'inactive'].includes(d.status) && can('vendor.approve') && <Btn kind={d.status === 'active' ? 'warn' : 'default'} onClick={() => setModal({ kind: 'toggle', v: d })}>{d.status === 'active' ? 'Deactivate' : 'Reactivate'}</Btn>}
          {d.bank && can('vendor.bank_reveal') && <Btn onClick={() => reveal(d)}>Reveal account</Btn>}
          {can('invoice.view_all') && <Link className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} to={`/invoices?vendor_id=${d.id}`}>View invoices</Link>}
        </div></>}
    </Drawer>}

    {modal?.kind === 'new' && <Modal wide title="Propose vendor" onClose={close}><Alert kind="info">A vendor cannot be paid until a different person approves it.</Alert>
      <VendorFields f={f} set={set} err={err} mode="new" canIdentity /><BankFields f={f} set={set} err={err} />
      {formErr && <Alert>{formErr}</Alert>}<div className="row end"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" busy={busy} onClick={propose}>Propose vendor</Btn></div></Modal>}
    {modal?.kind === 'edit' && <Modal wide title={`Edit · ${modal.v.name}`} onClose={close}><VendorFields f={f} set={set} err={err} mode="edit" canIdentity={can('vendor.approve')} />
      {formErr && <Alert>{formErr}</Alert>}<div className="row end"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" busy={busy} onClick={saveEdit}>Save changes</Btn></div></Modal>}
    {modal?.kind === 'bank' && <Modal title={`Change bank details · ${modal.v.name}`} onClose={close}><Alert kind="warn">A second person must approve this before it takes effect. Confirm the new details with the vendor by phone.</Alert>
      <BankFields f={f} set={set} err={err} /><div className="form" style={{ marginTop: 16 }}><Field label="Reason for the change" wide error={err.reason}><input value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-invalid={!!err.reason} /></Field></div>
      {formErr && <Alert>{formErr}</Alert>}<div className="row end"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" busy={busy} onClick={changeBank}>Propose change</Btn></div></Modal>}
    {modal?.kind === 'reject' && <ReasonModal title="Reject" prompt="Reason (required)" confirm="Reject" onClose={close} onSubmit={async (note) => {
      await api(modal.type === 'bank' ? `/vendors/bank-changes/${modal.id}/reject` : `/vendors/${modal.id}/reject`, { body: { note } }); toast('Rejected'); reloadAll(); }} />}
    {modal?.kind === 'toggle' && <Modal title={modal.v.status === 'active' ? 'Deactivate vendor' : 'Reactivate vendor'} onClose={close}>
      <Alert kind={modal.v.status === 'active' ? 'warn' : 'info'}>{modal.v.status === 'active' ? `${modal.v.name} will no longer appear when preparing payment runs. Existing records are kept. This is recorded in the audit log.` : `${modal.v.name} will be available for payments again.`}</Alert>
      <div className="row end"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" onClick={toggle}>{modal.v.status === 'active' ? 'Deactivate' : 'Reactivate'}</Btn></div></Modal>}
    {modal?.kind === 'reveal' && <Modal title={`Bank account · ${modal.v.name}`} onClose={close}>{!modal.data
      ? <><Alert kind="warn">Showing the full account number is recorded in the audit log with your name.</Alert><div className="row end"><Btn onClick={close}>Cancel</Btn><Btn kind="primary" onClick={confirmReveal}>Show account number</Btn></div></>
      : <><dl className="kv"><dt>Holder</dt><dd>{modal.data.account_name}</dd><dt>Account</dt><dd className="mono">{modal.data.account_number}</dd><dt>IFSC</dt><dd className="mono">{modal.data.ifsc}</dd><dt>Bank</dt><dd>{modal.data.bank_name || '—'}</dd></dl>
        <div className="row end"><Btn onClick={close}>Close</Btn></div></>}</Modal>}
  </Page>;
}
