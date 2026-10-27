import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, blobUrl } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Field, Page, Spinner, useToast } from '../components/ui';
import InvoiceForm, { InvoiceDraft, emptyDraft } from '../components/InvoiceForm';
import { toRupeesInput } from '../lib/format';

const draftFromExtraction = (ex: any, vendorId: string | null): InvoiceDraft => { const f = ex?.fields || {}; const v = (k: string) => f[k]?.value;
  return { ...emptyDraft(), number: v('invoice_number') || '', vendor_id: vendorId || '', invoice_date: v('invoice_date') || '', due_date: v('due_date') || '', subtotal: toRupeesInput(v('subtotal_minor')),
    cgst: toRupeesInput(v('cgst_minor')), sgst: toRupeesInput(v('sgst_minor')), igst: toRupeesInput(v('igst_minor')), cess: toRupeesInput(v('cess_minor')), round_off: toRupeesInput(v('round_off_minor')), total: toRupeesInput(v('total_minor')) }; };

function Review({ id, onDone }: { id: string; onDone: () => void }) {
  const { can } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const doc = useApi<any>(`/intake/${id}`); const [url, setUrl] = useState<string | null>(null); const [submitNow, setSubmitNow] = useState(false);
  const [newVendor, setNewVendor] = useState(false); const [nv, setNv] = useState({ name: '', gstin: '', category: '', account_name: '', account_number: '', ifsc: '', tds_section: '' });
  useEffect(() => { let u: string | null = null; blobUrl(`/intake/${id}/file`).then((x) => { u = x; setUrl(x); }).catch(() => setUrl(null)); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  const ex = doc.data?.extraction;
  const initial = useMemo(() => draftFromExtraction(ex, doc.data?.matched_vendor_id || null), [ex, doc.data?.matched_vendor_id]);
  useEffect(() => { if (ex && !doc.data?.matched_vendor_id) setNv((s) => ({ ...s, name: ex.fields.vendor_name?.value || '', gstin: ex.fields.vendor_gstin?.value || '', ifsc: ex.fields.ifsc?.value || '' })); }, [ex, doc.data?.matched_vendor_id]);
  if (doc.loading) return <Spinner />; if (doc.error) return <Alert>{doc.error}</Alert>;
  const d = doc.data;
  return <div className="split">
    <Card title={d.file_name} actions={<Badge status={d.status} />}>{url ? (d.mime === 'application/pdf' ? <iframe className="doc" title="Invoice document" src={url} /> : <img className="doc" style={{ objectFit: 'contain' }} src={url} alt="Uploaded invoice" />) : <Spinner />}
      <p className="muted">Text source: {d.text_source === 'pdf_text' ? 'the PDF text layer' : d.text_source === 'ocr' ? 'OCR (check carefully)' : 'none — enter details by hand'}</p></Card>
    <div className="grid">
      {d.error && <Alert kind="warn">{d.error}</Alert>}
      {d.duplicate && <Alert kind={d.duplicate.level === 'block' ? 'error' : 'warn'}>{d.duplicate.message}</Alert>}
      {ex && <Card title="Checks"><ul className="checks">{ex.checks.map((c: any, n: number) => <li key={n}><Badge status={c.status === 'pass' ? 'approved' : c.status === 'fail' ? 'rejected' : 'on_hold'} text={c.status} /> {c.message}</li>)}</ul>
        <small className="muted">Fields below are pre-filled from the document. Low-confidence values are not flagged for you, so verify every number against the document on the left. Nothing is submitted until you choose to.</small></Card>}
      {d.status === 'converted' ? <Alert kind="ok">This document became an invoice.</Alert> : <Card title="Verify and create invoice">
        {!d.matched_vendor_id && <div style={{ marginBottom: 10 }}><Alert kind="info">No existing vendor matches the GSTIN on this document. Pick a vendor below, or propose a new one (it must be approved by someone else before payment).</Alert>
          {can('vendor.propose') && <Btn className="sm" onClick={() => setNewVendor(!newVendor)}>{newVendor ? 'Use an existing vendor' : 'Propose a new vendor'}</Btn>}</div>}
        {newVendor && <div className="form" style={{ marginBottom: 12 }}>
          <Field label="Vendor name"><input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} /></Field><Field label="GSTIN"><input value={nv.gstin} onChange={(e) => setNv({ ...nv, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Account holder"><input value={nv.account_name} onChange={(e) => setNv({ ...nv, account_name: e.target.value })} /></Field><Field label="Account number"><input value={nv.account_number} onChange={(e) => setNv({ ...nv, account_number: e.target.value })} /></Field>
          <Field label="IFSC"><input value={nv.ifsc} onChange={(e) => setNv({ ...nv, ifsc: e.target.value.toUpperCase() })} /></Field><Field label="TDS section" hint="As configured for your organisation"><input value={nv.tds_section} onChange={(e) => setNv({ ...nv, tds_section: e.target.value })} /></Field></div>}
        <InvoiceForm initial={initial} submitLabel={submitNow ? 'Create and submit' : 'Create draft'}
          extra={can('invoice.edit_before_approval') ? <label className="row" style={{ marginTop: 10 }}><input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} /> Submit for approval right away (vendor must already be approved)</label> : null}
          onSubmit={async (p) => {
            const body: any = { ...p, submit: submitNow };
            if (newVendor) { delete body.vendor_id; body.new_vendor = { name: nv.name, gstin: nv.gstin || undefined, tds_section: nv.tds_section || undefined, category: nv.category || undefined, bank: { account_name: nv.account_name, account_number: nv.account_number, ifsc: nv.ifsc } }; }
            const r = await api(`/intake/${id}/create-invoice`, { body }); toast('Invoice created'); nav(`/invoices/${r.invoice.id}`);
          }} />
        <div className="row end"><Btn kind="danger" onClick={async () => { try { await api(`/intake/${id}/discard`, { body: {} }); toast('Discarded'); onDone(); } catch (e) { toast(errMsg(e), 'error'); } }}>Discard document</Btn></div></Card>}
    </div>
  </div>;
}

export default function Intake() {
  const { can } = useAuth(); const toast = useToast(); const list = useApi<any>('/intake?limit=50'); const [sel, setSel] = useState<string | null>(null); const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList) => { setBusy(true); for (const f of Array.from(files)) { const fd = new FormData(); fd.append('file', f); try { const r = await api('/intake/upload', { form: fd }); toast(`${f.name}: uploaded`); setSel(r.id); } catch (e) { toast(`${f.name}: ${errMsg(e)}`, 'error'); } } setBusy(false); list.reload(); };
  return <Page title="Invoice intake" sub="Upload a real invoice, check what was read, then create a draft" actions={can('invoice.upload') && <><input ref={file} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => e.target.files && upload(e.target.files)} /><Btn kind="primary" busy={busy} onClick={() => file.current?.click()}>Upload invoices (PDF, PNG, JPEG)</Btn></>}>
    <Card pad={false}>{list.loading ? <Spinner /> : list.error ? <Alert>{list.error}</Alert> : list.data.data.length === 0 ? <Empty>No documents yet.</Empty> : <div className="scroll"><table><thead><tr><th>File</th><th>Status</th><th>Invoice no.</th><th>Note</th></tr></thead><tbody>
      {list.data.data.map((d: any) => <tr key={d.id} className="click" style={sel === d.id ? { background: '#F1F7F5' } : undefined} onClick={() => setSel(d.id)}><td>{d.file_name}</td><td><Badge status={d.status} /></td><td className="mono">{d.extraction?.fields?.invoice_number?.value || '—'}</td><td className="muted">{d.error || (d.duplicate ? d.duplicate.message : '')}</td></tr>)}</tbody></table></div>}</Card>
    {sel && <Review key={sel} id={sel} onDone={() => { setSel(null); list.reload(); }} />}
  </Page>;
}
