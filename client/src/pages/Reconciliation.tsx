import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Field, Modal, Page, Pager, ReasonModal, Spinner, Tabs, useToast } from '../components/ui';
import { fmtDate, formatMinor, label, parseRupees } from '../lib/format';

const DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'DD-MM-YY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'DD MMM YY'];
const WORK = 'exception,suggested,pending_approval,unmatched,partial';

function MatchModal({ line, onClose, onDone }: { line: any; onClose: () => void; onDone: () => void }) {
  const c = useApi<any[]>('/bank/candidate-payments'); const [amt, setAmt] = useState<Record<string, string>>({}); const [err, setErr] = useState(''); const remaining = line.debit_minor - line.allocated_minor;
  let sum = 0; try { sum = Object.values(amt).reduce((a, v) => a + (v ? parseRupees(v) || 0 : 0), 0); } catch { /* shown on submit */ }
  const go = async () => { setErr(''); try { const allocations = Object.entries(amt).filter(([, v]) => v).map(([payment_id, v]) => ({ payment_id, amount_minor: parseRupees(v)! })); await api(`/bank/lines/${line.id}/match`, { body: { allocations } }); onDone(); onClose(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal wide title="Match to payment(s)" onClose={onClose}><p><b>{line.narration}</b> · debit {formatMinor(remaining)} still unmatched</p>
    {c.loading ? <Spinner /> : !c.data?.length ? <Empty>No released or paid payments are waiting to be reconciled.</Empty> : <div className="scroll"><table><thead><tr><th>Reference</th><th>Vendor · invoice</th><th>Released</th><th className="num">Left to match</th><th>Allocate (₹)</th></tr></thead><tbody>
      {c.data.map((p) => <tr key={p.id}><td className="mono">{p.reference}</td><td>{p.vendor_name}<div className="muted">{p.invoice_number}</div></td><td>{fmtDate(p.released_at)}</td><td className="num">{formatMinor(p.outstanding_minor)}</td>
        <td><input style={{ width: 130 }} inputMode="decimal" value={amt[p.id] || ''} onChange={(e) => setAmt({ ...amt, [p.id]: e.target.value })} placeholder={(p.outstanding_minor / 100).toFixed(2)} /></td></tr>)}</tbody></table></div>}
    <p>Allocated {formatMinor(sum)} of {formatMinor(remaining)}</p><Alert kind="info">A second person must approve a manual match before it counts.</Alert>{err && <Alert>{err}</Alert>}
    <div className="row end"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!sum} onClick={go}>Propose match</Btn></div></Modal>;
}

function Lines() {
  const { can } = useAuth(); const toast = useToast(); const [status, setStatus] = useState(WORK); const [page, setPage] = useState(1); const [dir, setDir] = useState('debit');
  const list = useApi<any>(`/bank/lines?page=${page}&limit=25&status=${status}${dir ? `&direction=${dir}` : ''}`); const sum = useApi<any>('/bank/summary');
  const [m, setM] = useState<any>(null); const [cat, setCat] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, msg: string) => { setBusy(true); try { await fn(); toast(msg); list.reload(); sum.reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } };
  return <>
    <div className="grid g4">{['exception', 'suggested', 'pending_approval', 'matched'].map((s) => <div className="stat" key={s}><div className="eyebrow">{label(s)}</div><b>{sum.data?.lines?.[s]?.count ?? 0}</b></div>)}<div className="stat"><div className="eyebrow">Payments not yet reconciled</div><b>{sum.data?.unreconciled_payments ?? 0}</b></div></div>
    <Card pad={false}><div className="row" style={{ padding: 14 }}>
      <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 240 }} aria-label="Status"><option value={WORK}>Needs attention</option><option value="matched">Matched</option><option value="classified,ignored">Classified or ignored</option><option value="exception">Exceptions only</option><option value="unmatched,exception,suggested,pending_approval,partial,matched,classified,ignored">Everything</option></select>
      <select value={dir} onChange={(e) => setDir(e.target.value)} style={{ width: 160 }} aria-label="Direction"><option value="debit">Debits (money out)</option><option value="credit">Credits (money in)</option><option value="">Both</option></select>
      {can('bank.reconcile') && <Btn onClick={() => act(() => api('/bank/run-matching', { body: {} }), 'Matching finished')} busy={busy}>Run matching again</Btn>}</div>
      {list.loading ? <Spinner /> : list.error ? <Alert>{list.error}</Alert> : list.data.data.length === 0 ? <Empty>No statement lines here.</Empty> : <div className="scroll"><table><thead><tr><th>Date</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th><th>Status</th><th /></tr></thead><tbody>
        {list.data.data.map((l: any) => <tr key={l.id}><td>{fmtDate(l.date)}</td><td>{l.narration}<div className="muted mono">{l.reference}</div></td><td className="num">{l.debit_minor ? formatMinor(l.debit_minor) : ''}</td><td className="num">{l.credit_minor ? formatMinor(l.credit_minor) : ''}</td>
          <td><Badge status={l.status} />{l.exception && <div className="muted">{label(l.exception.reason)}</div>}{l.suggestion && <div className="muted">{label(l.suggestion.method)} · {l.suggestion.allocations.length} payment(s)</div>}{l.category && <div className="muted">{l.category}</div>}
            {l.matches.map((x: any) => <div key={x.allocation_id} className="muted">{x.payment_reference} · {formatMinor(x.amount_minor)} · {label(x.method)}{x.state === 'pending_approval' ? ' (awaiting approval)' : ''}</div>)}</td>
          <td><div className="row">
            {l.status === 'suggested' && can('bank.reconcile') && <><Btn className="sm" kind="primary" onClick={() => act(() => api(`/bank/lines/${l.id}/confirm-suggestion`, { body: {} }), 'Sent for approval')}>Confirm</Btn><Btn className="sm" onClick={() => act(() => api(`/bank/lines/${l.id}/reject-suggestion`, { body: {} }), 'Suggestion rejected')}>Reject</Btn></>}
            {['unmatched', 'exception', 'partial'].includes(l.status) && l.debit_minor > 0 && can('bank.reconcile') && <Btn className="sm" onClick={() => setM({ match: l })}>Match…</Btn>}
            {['unmatched', 'exception', 'suggested'].includes(l.status) && can('bank.reconcile') && <Btn className="sm" onClick={() => { setCat(''); setM({ classify: l }); }}>Classify</Btn>}
            {l.status === 'pending_approval' && can('bank.approve_manual_match') && <><Btn className="sm" kind="primary" onClick={() => act(() => api(`/bank/lines/${l.id}/approve-match`, { body: {} }), 'Match approved')}>Approve</Btn><Btn className="sm" kind="danger" onClick={() => setM({ reject: l })}>Reject</Btn></>}
            {['matched', 'partial'].includes(l.status) && can('bank.approve_manual_match') && <Btn className="sm" onClick={() => setM({ unmatch: l })}>Undo match</Btn>}</div></td></tr>)}</tbody></table></div>}
      {list.data && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}</Card>
    {m?.match && <MatchModal line={m.match} onClose={() => setM(null)} onDone={() => { toast('Sent for approval'); list.reload(); sum.reload(); }} />}
    {m?.reject && <ReasonModal title="Reject match" prompt="Reason" confirm="Reject" onClose={() => setM(null)} onSubmit={async (note) => { await api(`/bank/lines/${m.reject.id}/reject-match`, { body: { note } }); list.reload(); sum.reload(); }} />}
    {m?.unmatch && <ReasonModal title="Undo match" prompt="Why is this match wrong?" confirm="Undo match" onClose={() => setM(null)} onSubmit={async (reason) => { await api(`/bank/lines/${m.unmatch.id}/unmatch`, { body: { reason } }); list.reload(); sum.reload(); }} />}
    {m?.classify && <Modal title="Classify line" onClose={() => setM(null)}><Field label="Category" hint="e.g. bank_charges, interest, refund"><input value={cat} onChange={(e) => setCat(e.target.value)} autoFocus /></Field><div className="row end"><Btn onClick={() => act(async () => { await api(`/bank/lines/${m.classify.id}/classify`, { body: { ignore: true, category: cat || null } }); setM(null); }, 'Ignored')}>Ignore line</Btn><Btn kind="primary" disabled={!cat} onClick={() => act(async () => { await api(`/bank/lines/${m.classify.id}/classify`, { body: { category: cat } }); setM(null); }, 'Classified')}>Save category</Btn></div></Modal>}
  </>;
}

function ImportTab() {
  const { can } = useAuth(); const toast = useToast(); const acc = useApi<any[]>('/bank/accounts'); const [aid, setAid] = useState(''); const prof = useApi<any[]>(aid ? `/bank/profiles?bank_account_id=${aid}` : null);
  const [pid, setPid] = useState(''); const [file, setFile] = useState<File | null>(null); const [res, setRes] = useState<any>(null); const [errs, setErrs] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [prev, setPrev] = useState<any>(null); const [busy, setBusy] = useState(false);
  const submit = async () => { if (!file) return; setBusy(true); setMsg(''); setErrs([]); setRes(null); const fd = new FormData(); fd.append('bank_account_id', aid); fd.append('profile_id', pid); fd.append('file', file);
    try { const r = await api('/bank/imports', { form: fd }); setRes(r); toast('Statement imported'); } catch (e) { setMsg(errMsg(e)); if (e instanceof ApiError && e.details?.errors) setErrs(e.details.errors); } finally { setBusy(false); } };
  const preview = async () => { if (!file || !pid) return; const p = prof.data?.find((x) => x._id === pid); const fd = new FormData(); fd.append('file', file); const { _id, __v, createdAt, updatedAt, organisation_id, bank_account_id, ...rest } = p; fd.append('profile', JSON.stringify(rest)); setBusy(true); try { setPrev(await api('/bank/profiles/preview', { form: fd })); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } };
  return <Card title="Import a bank statement">{!can('bank.import') ? <Alert kind="info">You can view statements but not import them.</Alert> : <>
    <div className="form"><Field label="Bank account"><select value={aid} onChange={(e) => { setAid(e.target.value); setPid(''); }}><option value="">Select…</option>{(acc.data || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select></Field>
      <Field label="Statement layout (mapping profile)"><select value={pid} onChange={(e) => setPid(e.target.value)} disabled={!aid}><option value="">Select…</option>{(prof.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
      <Field label="Statement file (CSV or Excel .xlsx)"><input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field></div>
    <div className="row end"><Btn disabled={!pid || !file} busy={busy} onClick={preview}>Preview how it will be read</Btn><Btn kind="primary" disabled={!pid || !file} busy={busy} onClick={submit}>Import</Btn></div>
    {msg && <Alert>{msg}</Alert>}{errs.length > 0 && <ul>{errs.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
    {res && <Alert kind={res.balance_check?.ok === false ? 'warn' : 'ok'}>{res.line_count} lines imported, {res.skipped_duplicates} already present. {res.balance_check?.checked ? (res.balance_check.ok ? 'Running balance checks out.' : `Running balance does NOT add up on ${res.balance_check.mismatches.length} row(s): check the statement before relying on it.`) : 'No balance column to check.'} Automatic matching has run.</Alert>}
    {prev && <div><h3 style={{ margin: '12px 0 6px' }}>Preview: {prev.line_count} line(s) readable</h3>{prev.errors.length > 0 && <Alert>{prev.errors.map((e: any) => `Row ${e.row}: ${e.message}`).join(' · ')}</Alert>}
      <div className="scroll"><table><thead><tr><th>Date</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead><tbody>{prev.lines.map((l: any, i: number) => <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.narration}</td><td className="num">{l.debit_minor ? formatMinor(l.debit_minor) : ''}</td><td className="num">{l.credit_minor ? formatMinor(l.credit_minor) : ''}</td><td className="num">{l.balance_minor === null ? '' : formatMinor(l.balance_minor)}</td></tr>)}</tbody></table></div></div>}</>}</Card>;
}

function Setup() {
  const toast = useToast(); const acc = useApi<any[]>('/bank/accounts'); const prof = useApi<any[]>('/bank/profiles'); const [m, setM] = useState<any>(null); const [f, setF] = useState<any>({}); const [err, setErr] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const saveAcc = async () => { try { await api('/bank/accounts', { body: { name: f.name, bank_name: f.bank_name || undefined, account_last4: f.account_last4 || undefined, ifsc: f.ifsc || undefined } }); toast('Bank account added'); setM(null); acc.reload(); } catch (e) { setErr(errMsg(e)); } };
  const saveProf = async () => { try { const b: any = { bank_account_id: f.bank_account_id, name: f.name, format: f.format || 'csv', header_row: Number(f.header_row || 1) - 1, date_column: f.date_column, date_format: f.date_format || 'DD/MM/YYYY', narration_column: f.narration_column, reference_column: f.reference_column || null,
      amount_mode: f.amount_mode || 'separate', debit_column: f.debit_column || null, credit_column: f.credit_column || null, amount_column: f.amount_column || null, drcr_column: f.drcr_column || null, balance_column: f.balance_column || null, decimal_separator: f.decimal_separator || '.', skip_footer_rows: Number(f.skip_footer_rows || 0) };
    await api('/bank/profiles', { body: b }); toast('Layout saved'); setM(null); prof.reload(); } catch (e) { setErr(errMsg(e)); } };
  const mode = f.amount_mode || 'separate';
  return <div className="grid">
    <Card title="Bank accounts" actions={<Btn onClick={() => { setF({}); setErr(''); setM('acc'); }}>Add account</Btn>} pad={false}>{!acc.data?.length ? <Empty>No bank accounts yet.</Empty> : <table><tbody>{acc.data.map((a) => <tr key={a._id}><td>{a.name}</td><td className="muted">{a.bank_name}</td><td className="mono">{a.account_last4 ? `••••${a.account_last4}` : ''} {a.ifsc}</td></tr>)}</tbody></table>}</Card>
    <Card title="Statement layouts" actions={<Btn onClick={() => { setF({ bank_account_id: acc.data?.[0]?._id }); setErr(''); setM('prof'); }} disabled={!acc.data?.length}>Add layout</Btn>} pad={false}>
      <div className="card-b"><small className="muted">Every bank exports statements differently. Tell InvoiceFlow once which columns to use; it will remember. Use the preview on the Import tab to check the result before importing.</small></div>
      {!prof.data?.length ? <Empty>No layouts yet.</Empty> : <table><thead><tr><th>Name</th><th>Date</th><th>Amounts</th></tr></thead><tbody>{prof.data.map((p) => <tr key={p._id}><td>{p.name}</td><td>{p.date_column} ({p.date_format})</td><td>{p.amount_mode === 'separate' ? `${p.debit_column} / ${p.credit_column}` : p.amount_column}</td></tr>)}</tbody></table>}</Card>
    {m === 'acc' && <Modal title="Add bank account" onClose={() => setM(null)}><div className="form"><Field label="Name"><input value={f.name || ''} onChange={set('name')} /></Field><Field label="Bank"><input value={f.bank_name || ''} onChange={set('bank_name')} /></Field><Field label="Last 4 digits"><input maxLength={4} value={f.account_last4 || ''} onChange={set('account_last4')} /></Field><Field label="IFSC"><input value={f.ifsc || ''} onChange={set('ifsc')} /></Field></div>{err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={() => setM(null)}>Cancel</Btn><Btn kind="primary" onClick={saveAcc}>Save</Btn></div></Modal>}
    {m === 'prof' && <Modal wide title="Add statement layout" onClose={() => setM(null)}><div className="form">
      <Field label="Bank account"><select value={f.bank_account_id || ''} onChange={set('bank_account_id')}>{(acc.data || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select></Field><Field label="Layout name"><input value={f.name || ''} onChange={set('name')} /></Field>
      <Field label="File type"><select value={f.format || 'csv'} onChange={set('format')}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select></Field><Field label="Header is on row" hint="Row number of the column titles (1 = first row)"><input inputMode="numeric" value={f.header_row || '1'} onChange={set('header_row')} /></Field>
      <Field label="Date column title"><input value={f.date_column || ''} onChange={set('date_column')} /></Field><Field label="Date format"><select value={f.date_format || 'DD/MM/YYYY'} onChange={set('date_format')}>{DATE_FORMATS.map((d) => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Narration column title"><input value={f.narration_column || ''} onChange={set('narration_column')} /></Field><Field label="Reference / cheque no. column (optional)"><input value={f.reference_column || ''} onChange={set('reference_column')} /></Field>
      <Field label="How are amounts shown?"><select value={mode} onChange={set('amount_mode')}><option value="separate">Separate debit and credit columns</option><option value="signed">One amount column (negative = money out)</option><option value="amount_drcr">One amount column plus a Dr/Cr column</option></select></Field>
      {mode === 'separate' ? <><Field label="Debit (withdrawal) column title"><input value={f.debit_column || ''} onChange={set('debit_column')} /></Field><Field label="Credit (deposit) column title"><input value={f.credit_column || ''} onChange={set('credit_column')} /></Field></> : <Field label="Amount column title"><input value={f.amount_column || ''} onChange={set('amount_column')} /></Field>}
      {mode === 'amount_drcr' && <Field label="Dr/Cr column title"><input value={f.drcr_column || ''} onChange={set('drcr_column')} /></Field>}
      <Field label="Balance column title (optional)" hint="Lets InvoiceFlow check the statement adds up"><input value={f.balance_column || ''} onChange={set('balance_column')} /></Field>
      <Field label="Decimal separator"><select value={f.decimal_separator || '.'} onChange={set('decimal_separator')}><option value=".">Dot (1,234.50)</option><option value=",">Comma (1.234,50)</option></select></Field><Field label="Footer rows to ignore"><input inputMode="numeric" value={f.skip_footer_rows || '0'} onChange={set('skip_footer_rows')} /></Field></div>
      {err && <Alert>{err}</Alert>}<div className="row end"><Btn onClick={() => setM(null)}>Cancel</Btn><Btn kind="primary" onClick={saveProf}>Save layout</Btn></div></Modal>}
  </div>;
}

export default function Reconciliation() {
  const { can } = useAuth(); const [tab, setTab] = useState('lines');
  return <Page title="Bank reconciliation" sub="Statement lines matched to released payments">
    <Tabs value={tab} onChange={setTab} tabs={[{ key: 'lines', label: 'Statement lines' }, ...(can('bank.import') || can('bank.configure') ? [{ key: 'import', label: 'Import' }] : []), ...(can('bank.configure') ? [{ key: 'setup', label: 'Accounts & layouts' }] : [])]} />
    {tab === 'lines' && <Lines />}{tab === 'import' && <ImportTab />}{tab === 'setup' && <Setup />}</Page>;
}
