import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Alert, Btn, Field } from './ui';
import { isoDate, parseRupees, toRupeesInput, formatMinor } from '../lib/format';

export interface InvoiceDraft {
  number: string; vendor_id: string; invoice_date: string; due_date: string;
  subtotal: string; cgst: string; sgst: string; igst: string; cess: string; round_off: string; total: string;
  department: string; cost_centre: string; description: string; lines: { description: string; amount: string; gl_code: string }[];
}
export const emptyDraft = (): InvoiceDraft => ({ number: '', vendor_id: '', invoice_date: '', due_date: '', subtotal: '', cgst: '', sgst: '', igst: '', cess: '', round_off: '', total: '', department: '', cost_centre: '', description: '', lines: [] });
export const draftFromInvoice = (i: any): InvoiceDraft => ({ number: i.number, vendor_id: i.vendor_id, invoice_date: isoDate(i.invoice_date), due_date: isoDate(i.due_date), subtotal: toRupeesInput(i.subtotal_minor),
  cgst: toRupeesInput(i.cgst_minor), sgst: toRupeesInput(i.sgst_minor), igst: toRupeesInput(i.igst_minor), cess: toRupeesInput(i.cess_minor), round_off: toRupeesInput(i.round_off_minor), total: toRupeesInput(i.total_minor),
  department: i.department || '', cost_centre: i.cost_centre || '', description: i.description || '', lines: (i.line_items || []).map((l: any) => ({ description: l.description, amount: toRupeesInput(l.amount_minor), gl_code: l.gl_code || '' })) });

export function toPayload(d: InvoiceDraft, override?: string) {
  const m = (s: string) => parseRupees(s) ?? 0;
  const lines = d.lines.filter((l) => l.description || l.amount).map((l) => ({ description: l.description, amount_minor: m(l.amount), ...(l.gl_code ? { gl_code: l.gl_code } : {}) }));
  return { number: d.number.trim(), vendor_id: d.vendor_id, invoice_date: d.invoice_date, due_date: d.due_date, subtotal_minor: m(d.subtotal), cgst_minor: m(d.cgst), sgst_minor: m(d.sgst), igst_minor: m(d.igst),
    cess_minor: m(d.cess), round_off_minor: m(d.round_off), total_minor: m(d.total), department: d.department || null, cost_centre: d.cost_centre || null, description: d.description,
    ...(lines.length ? { line_items: lines } : {}), ...(override ? { duplicate_override_reason: override } : {}) };
}

export default function InvoiceForm({ initial, onSubmit, submitLabel = 'Save', lockVendor, extra }: { initial: InvoiceDraft; onSubmit: (payload: any, draft: InvoiceDraft) => Promise<void>; submitLabel?: string; lockVendor?: boolean; extra?: React.ReactNode }) {
  const [d, setD] = useState<InvoiceDraft>(initial); useEffect(() => setD(initial), [initial]);
  const vendors = useApi<any[]>('/vendors/options');
  const [err, setErr] = useState(''); const [dup, setDup] = useState<string | null>(null); const [override, setOverride] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof InvoiceDraft) => (e: any) => setD({ ...d, [k]: e.target.value });
  const compute = () => { try { const t = ['subtotal', 'cgst', 'sgst', 'igst', 'cess', 'round_off'].reduce((a, k) => a + (parseRupees((d as any)[k]) ?? 0), 0); setD({ ...d, total: toRupeesInput(t) }); } catch (e: any) { setErr(e.message); } };
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await onSubmit(toPayload(d, override), d); }
    catch (e: any) { if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') setDup(e.message); else setErr(e.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  const sum = d.lines.reduce((a, l) => { try { return a + (parseRupees(l.amount) ?? 0); } catch { return a; } }, 0);
  return <div>
    <div className="form">
      <Field label="Invoice number"><input value={d.number} onChange={set('number')} /></Field>
      <Field label="Vendor"><select value={d.vendor_id} onChange={set('vendor_id')} disabled={lockVendor}><option value="">Select…</option>{(vendors.data || []).map((v) => <option key={v.id} value={v.id}>{v.name}{v.status !== 'active' ? ' (awaiting approval)' : ''}</option>)}</select></Field>
      <Field label="Invoice date"><input type="date" value={d.invoice_date} onChange={set('invoice_date')} /></Field>
      <Field label="Due date"><input type="date" value={d.due_date} onChange={set('due_date')} /></Field>
      <Field label="Taxable value (₹)"><input inputMode="decimal" value={d.subtotal} onChange={set('subtotal')} /></Field>
      <Field label="CGST (₹)"><input inputMode="decimal" value={d.cgst} onChange={set('cgst')} /></Field>
      <Field label="SGST (₹)"><input inputMode="decimal" value={d.sgst} onChange={set('sgst')} /></Field>
      <Field label="IGST (₹)"><input inputMode="decimal" value={d.igst} onChange={set('igst')} /></Field>
      <Field label="Cess (₹)"><input inputMode="decimal" value={d.cess} onChange={set('cess')} /></Field>
      <Field label="Round-off (₹)" hint="Can be negative"><input inputMode="decimal" value={d.round_off} onChange={set('round_off')} /></Field>
      <Field label="Invoice total (₹)" hint="Must equal taxable value + taxes + round-off"><div className="row"><input inputMode="decimal" value={d.total} onChange={set('total')} /><Btn type="button" onClick={compute}>Add up</Btn></div></Field>
      <Field label="Department"><input value={d.department} onChange={set('department')} /></Field>
      <Field label="Cost centre"><input value={d.cost_centre} onChange={set('cost_centre')} /></Field>
      <Field label="Description" wide><textarea rows={2} value={d.description} onChange={set('description')} /></Field>
    </div>
    <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Line items <span className="muted" style={{ fontWeight: 400 }}>(optional; must add up to the taxable value)</span></h3>
    {d.lines.map((l, i) => <div className="row" key={i} style={{ marginBottom: 6 }}>
      <input style={{ flex: 3 }} placeholder="Description" value={l.description} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
      <input style={{ flex: 1 }} placeholder="GL code" value={l.gl_code} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, gl_code: e.target.value } : x)) })} />
      <input style={{ flex: 1 }} placeholder="Amount ₹" inputMode="decimal" value={l.amount} onChange={(e) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
      <Btn type="button" className="sm" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })}>Remove</Btn></div>)}
    <div className="row"><Btn type="button" className="sm" onClick={() => setD({ ...d, lines: [...d.lines, { description: '', amount: '', gl_code: '' }] })}>Add line</Btn>{d.lines.length > 0 && <span className="muted">Lines total {formatMinor(sum)}</span>}</div>
    {extra}
    {dup && <Alert kind="warn"><b>Possible duplicate.</b> {dup}<Field label="Reason to continue (recorded in the audit log)"><input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Second consignment, confirmed with vendor" /></Field></Alert>}
    {err && <Alert>{err}</Alert>}
    <div className="row end"><Btn kind="primary" busy={busy} onClick={submit}>{dup ? 'Save with reason' : submitLabel}</Btn></div>
  </div>;
}
