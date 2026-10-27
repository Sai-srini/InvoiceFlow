import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, openFile } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Field, Modal, Page, Pager, ReasonModal, Spinner, useToast } from '../components/ui';
import InvoiceForm, { draftFromInvoice, emptyDraft } from '../components/InvoiceForm';
import { fmtDate, fmtDateTime, formatMinor, label } from '../lib/format';

const STATUSES = ['draft', 'in_review', 'on_hold', 'approved', 'rejected', 'scheduled', 'released', 'paid', 'reconciled'];

export function InvoiceList() {
  const { can, canAny } = useAuth(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || ''; const q = sp.get('q') || ''; const vendorId = sp.get('vendor_id') || ''; const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}), ...(q ? { q } : {}), ...(vendorId ? { vendor_id: vendorId } : {}) }).toString();
  const list = useApi<any>(`/invoices?${qs}`);
  const toast = useToast();
  return <Page title="Invoices" sub="Accounts payable" actions={<>
    <Btn onClick={() => openFile(`/invoices?${qs}&format=csv`, { download: 'invoices.csv' }).catch((e) => toast(errMsg(e), 'error'))}>Export CSV</Btn>
    {canAny('invoice.create', 'invoice.create_own') && <Link to="/invoices/new"><Btn kind="primary">New invoice</Btn></Link>}
    {can('invoice.upload') && <Link to="/intake"><Btn>Upload documents</Btn></Link>}</>}>
    {vendorId && <Alert kind="info">Showing invoices for one vendor. <button className="btn sm" onClick={() => { sp.delete('vendor_id'); setSp(sp); }}>Show all invoices</button></Alert>}
    <Card pad={false}>
      <div className="row" style={{ padding: 14 }}>
        <select value={status} onChange={(e) => { setSp({ ...(q ? { q } : {}), ...(e.target.value ? { status: e.target.value } : {}) }); setPage(1); }} style={{ width: 200 }} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <input placeholder="Search invoice number" defaultValue={q} onKeyDown={(e) => { if (e.key === 'Enter') { setSp({ ...(status ? { status } : {}), ...((e.target as HTMLInputElement).value ? { q: (e.target as HTMLInputElement).value } : {}) }); setPage(1); } }} style={{ width: 260 }} />
      </div>
      {list.loading ? <Spinner /> : list.error ? <Alert>{list.error}</Alert> : list.data.data.length === 0 ? <Empty>No invoices match.</Empty> : <div className="scroll"><table>
        <thead><tr><th>Number</th><th>Vendor</th><th>Status</th><th>Due</th><th className="num">Total</th><th className="num">Net payable</th></tr></thead>
        <tbody>{list.data.data.map((i: any) => <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}><td className="mono">{i.number}</td><td>{i.vendor_name}</td><td><Badge status={i.status} /></td><td>{fmtDate(i.due_date)}</td><td className="num">{formatMinor(i.total_minor)}</td><td className="num">{formatMinor(i.net_payable_minor)}</td></tr>)}</tbody></table></div>}
      {list.data && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
    </Card></Page>;
}

export function InvoiceNew() {
  const nav = useNavigate(); const toast = useToast();
  return <Page title="New invoice" sub="Created as a draft. Submit it for approval from the invoice page."><Card><InvoiceForm initial={emptyDraft()} submitLabel="Create draft"
    onSubmit={async (p) => { const r = await api('/invoices', { body: p }); toast('Draft created'); nav(`/invoices/${r.id}`); }} /></Card></Page>;
}

export function InvoiceDetail() {
  const { id } = useParams(); const { user, can, canAny } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const inv = useApi<any>(`/invoices/${id}`); const audit = useApi<any>(can('audit.view') ? `/invoices/${id}/audit?limit=20` : null);
  const [modal, setModal] = useState<'edit' | 'reject' | 'hold' | 'resume' | null>(null); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null);
  const [approveNote, setApproveNote] = useState('');
  const [doc, setDoc] = useState<{ url: string; mime: string } | null>(null);
  const viewDoc = async () => { try { const res: Response = await api(`/invoices/${id}/file`, { raw: true }); const blob = await res.blob(); setDoc({ url: URL.createObjectURL(blob), mime: res.headers.get('content-type') || blob.type || 'application/pdf' }); } catch (e) { toast(errMsg(e), 'error'); } };
  const closeDoc = () => { if (doc) URL.revokeObjectURL(doc.url); setDoc(null); };
  useEffect(() => () => { if (doc) URL.revokeObjectURL(doc.url); }, [doc]);
  useEffect(() => { setModal(null); }, [id]);
  if (inv.loading) return <Spinner />; if (inv.error) return <div className="page"><Alert>{inv.error}</Alert></div>;
  const i = inv.data; const steps: any[] = i.approval_steps || []; const round = Math.max(1, ...steps.map((s) => s.round));
  const current = steps.filter((s) => s.round === round);
  const mine = current.find((s) => s.approver_id === user?.id && s.status === 'pending');
  const act = async (path: string, body: any = {}, msg = 'Done') => { setBusy(true); try { await api(`/invoices/${id}/${path}`, { body }); toast(msg); await inv.reload(); audit.reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } };
  const editable = ['draft', 'on_hold'].includes(i.status) && (can('invoice.edit_before_approval') || (i.created_by === user?.id && can('invoice.create_own')));
  const upload = async (f: File) => { const fd = new FormData(); fd.append('file', f); setBusy(true); try { await api(`/invoices/${id}/file`, { form: fd }); toast('Document attached'); inv.reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } };
  return <Page title={`Invoice ${i.number}`} sub={i.vendor_name} actions={<><Badge status={i.status} />{i.has_file && <Btn busy={busy} onClick={viewDoc}>View document</Btn>}</>}>
    {i.hold && <Alert kind="warn"><b>On hold:</b> {i.hold.reason}</Alert>}{i.rejection && <Alert>Rejected: {i.rejection.reason}</Alert>}
    <div className="grid g4">
      <div className="stat"><div className="eyebrow">Invoice total</div><b>{formatMinor(i.total_minor)}</b><small>Taxable {formatMinor(i.subtotal_minor)}</small></div>
      <div className="stat"><div className="eyebrow">TDS</div><b>{formatMinor(i.tds_minor)}</b><small>{i.tds_section ? `${i.tds_section} · ${i.tds_rate_bps / 100}%` : 'None'}</small></div>
      <div className="stat"><div className="eyebrow">Net payable</div><b>{formatMinor(i.net_payable_minor)}</b></div>
      <div className="stat"><div className="eyebrow">Due</div><b style={{ fontSize: 18 }}>{fmtDate(i.due_date)}</b><small>Invoice date {fmtDate(i.invoice_date)}</small></div>
    </div>
    <Card title="Actions"><div className="row">
      {i.status === 'draft' && <Btn kind="primary" busy={busy} onClick={() => act('submit', {}, 'Submitted for approval')}>Submit for approval</Btn>}
      {editable && <Btn onClick={() => setModal('edit')}>Edit</Btn>}
      {editable && <><input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Btn onClick={() => file.current?.click()}>{i.has_file ? 'Replace document' : 'Attach document'}</Btn></>}
      {i.status === 'on_hold' && <Btn kind="primary" onClick={() => setModal('resume')}>Answer query and resume</Btn>}
      {i.status === 'rejected' && <Btn onClick={() => act('reopen', {}, 'Reopened as draft')}>Reopen as draft</Btn>}
      {i.status === 'in_review' && can('invoice.approve') && <><input placeholder="Optional note" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} style={{ width: 220 }} /><Btn kind="primary" busy={busy} disabled={!mine} title={mine ? '' : 'This invoice is not waiting for you'} onClick={() => act('approve', { comment: approveNote || undefined }, 'Approved')}>Approve</Btn></>}
      {i.status === 'in_review' && can('invoice.hold') && <Btn kind="warn" onClick={() => setModal('hold')}>Hold with query</Btn>}
      {i.status === 'in_review' && can('invoice.reject') && <Btn kind="danger" onClick={() => setModal('reject')}>Reject</Btn>}
      {i.status === 'in_review' && !can('invoice.approve') && !can('invoice.reject') && !can('invoice.hold') && <span className="muted">Waiting for the approvers listed below.</span>}
      {['approved', 'scheduled', 'released', 'paid', 'reconciled'].includes(i.status) && <span className="muted">No actions here. Payment steps happen under Payment runs and Reconciliation.</span>}
    </div>{i.status === 'in_review' && can('invoice.approve') && !mine && <small className="muted">You can approve only when a step is assigned to you and it is your turn.</small>}</Card>
    <div className="grid g2">
      <Card title={`Approvals${i.rule_name ? ` · ${i.rule_name}` : ''}`}>{current.length === 0 ? <div className="muted">Not submitted yet.</div> : <ul className="timeline">{current.map((s) => <li key={s.id}>
        <div className={`dot ${s.status === 'approved' ? 'done' : s.status === 'rejected' ? 'bad' : ''}`}>{s.step_order}</div><div><b>{s.approver_name}</b> <Badge status={s.status} />
          <div className="muted">{s.status === 'pending' ? (s.activated_at ? `Waiting since ${fmtDateTime(s.activated_at)}${s.escalated_at ? ' · escalated' : ''}` : 'Not started (earlier step first)') : `${fmtDateTime(s.decided_at)}${s.acted_by_name && s.acted_by_name !== s.approver_name ? ` · by ${s.acted_by_name} (delegate)` : ''}`}{s.comment ? ` · ${s.comment}` : ''}</div></div></li>)}</ul>}</Card>
      <Card title="Details"><table><tbody>
        <tr><td className="muted">Vendor</td><td>{i.vendor_name} <span className="mono muted">{i.vendor_gstin}</span></td></tr><tr><td className="muted">Department / cost centre</td><td>{i.department || '—'} / {i.cost_centre || '—'}</td></tr>
        <tr><td className="muted">CGST / SGST / IGST</td><td className="mono">{formatMinor(i.cgst_minor)} / {formatMinor(i.sgst_minor)} / {formatMinor(i.igst_minor)}</td></tr>
        <tr><td className="muted">Created by</td><td>{i.created_by_name}</td></tr>{i.duplicate_override && <tr><td className="muted">Duplicate override</td><td>{i.duplicate_override.reason}</td></tr>}
        <tr><td className="muted">Description</td><td>{i.description || '—'}</td></tr></tbody></table>
        {i.line_items?.length > 0 && <table style={{ marginTop: 8 }}><thead><tr><th>Line</th><th>GL</th><th className="num">Amount</th></tr></thead><tbody>{i.line_items.map((l: any, n: number) => <tr key={n}><td>{l.description}</td><td>{l.gl_code}</td><td className="num">{formatMinor(l.amount_minor)}</td></tr>)}</tbody></table>}</Card>
    </div>
    <Card title="Discussion">{i.comments.length === 0 ? <div className="muted">No comments yet.</div> : i.comments.map((c: any) => <div key={c.id} style={{ padding: '6px 0', borderTop: '1px solid #EEF1F4' }}><b>{c.author_name}</b> <Badge status={c.kind === 'query' ? 'on_hold' : 'draft'} text={label(c.kind)} /> <small className="muted">{fmtDateTime(c.createdAt)}</small><div>{c.body}</div></div>)}
      {can('invoice.comment') && <div className="row" style={{ marginTop: 10 }}><input style={{ flex: 1 }} placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} /><Btn disabled={!comment.trim()} onClick={async () => { try { await api(`/invoices/${id}/comments`, { body: { body: comment } }); setComment(''); inv.reload(); } catch (e) { toast(errMsg(e), 'error'); } }}>Post</Btn></div>}</Card>
    {audit.data && <Card title="Audit trail" pad={false}><div className="scroll"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>{audit.data.data.map((a: any) => <tr key={a.seq}><td className="mono">{a.seq}</td><td>{fmtDateTime(a.at)}</td><td>{a.actor_name}</td><td>{a.action}</td></tr>)}</tbody></table></div></Card>}
    {modal === 'edit' && <Modal wide title="Edit invoice" onClose={() => setModal(null)}>{i.status === 'on_hold' && <Alert kind="warn">Editing an invoice on hold cancels its approvals. It returns to draft and must be submitted again.</Alert>}
      <InvoiceForm initial={draftFromInvoice(i)} submitLabel="Save changes" onSubmit={async (p) => { await api(`/invoices/${id}`, { method: 'PUT', body: p }); toast('Saved'); setModal(null); inv.reload(); }} /></Modal>}
    {modal === 'reject' && <ReasonModal title="Reject invoice" prompt="Reason (the submitter will see this)" confirm="Reject" onClose={() => setModal(null)} onSubmit={async (reason) => { await api(`/invoices/${id}/reject`, { body: { reason } }); toast('Rejected'); inv.reload(); }} />}
    {modal === 'hold' && <ReasonModal title="Hold with query" prompt="Your question for the Accounts Team" confirm="Hold" onClose={() => setModal(null)} onSubmit={async (reason) => { await api(`/invoices/${id}/hold`, { body: { reason } }); toast('Invoice on hold'); inv.reload(); }} />}
    {modal === 'resume' && <ReasonModal title="Answer query" prompt="Your answer" min={1} confirm="Resume review" onClose={() => setModal(null)} onSubmit={async (response) => { await api(`/invoices/${id}/resume`, { body: { response } }); toast('Back in review'); inv.reload(); }} />}
    {doc && <Modal wide title="Invoice document" onClose={closeDoc}>
      {doc.mime.includes('pdf')
        ? <iframe className="doc" title="Invoice document" src={doc.url} />
        : <img className="doc" style={{ objectFit: 'contain' }} src={doc.url} alt="Invoice document" />}
      <div className="row end" style={{ marginTop: 10 }}>
        <small className="muted" style={{ maxWidth: '24ch' }}>Opened inline with your session — nothing ever leaves the private file store.</small>
        <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'center' }}>Open in new tab</a>
        <Btn onClick={closeDoc}>Close</Btn></div></Modal>}
    <div><Btn onClick={() => nav(-1)}>Back</Btn></div>
  </Page>;
}
