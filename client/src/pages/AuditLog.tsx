import { Fragment, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, openFile } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Btn, Card, Empty, Page, Pager, Spinner, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function AuditLog() {
  const { can } = useAuth(); const toast = useToast(); const [page, setPage] = useState(1); const [action, setAction] = useState(''); const [entity, setEntity] = useState(''); const [open, setOpen] = useState<number | null>(null); const [ver, setVer] = useState<any>(null);
  const qs = `page=${page}&limit=30${action ? `&action=${encodeURIComponent(action)}` : ''}${entity ? `&entity_type=${encodeURIComponent(entity)}` : ''}`;
  const list = useApi<any>(`/audit?${qs}`);
  return <Page title="Audit log" sub="Every change, who made it and when. Entries are chained so edits are detectable." actions={<>
    <Btn onClick={async () => { try { setVer(await api('/audit/verify')); } catch (e) { toast(errMsg(e), 'error'); } }}>Verify integrity</Btn>
    {can('audit.export') && <Btn onClick={() => openFile(`/audit?${qs}&format=csv`, { download: 'audit-log.csv' }).catch((e) => toast(errMsg(e), 'error'))}>Export CSV</Btn>}</>}>
    {ver && (ver.ok ? <Alert kind="ok">Chain verified: {ver.checked} entries are intact.</Alert> : <Alert>Integrity check FAILED at entry {ver.broken_at}: {ver.reason}</Alert>)}
    <Card pad={false}><div className="row" style={{ padding: 14 }}><input style={{ width: 260 }} placeholder="Filter by action, e.g. invoice.approve" onKeyDown={(e) => e.key === 'Enter' && (setAction((e.target as HTMLInputElement).value), setPage(1))} />
      <select style={{ width: 200 }} value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity"><option value="">All records</option>{['Invoice', 'Vendor', 'PaymentRun', 'Payment', 'StatementLine', 'StatementImport', 'User', 'Role', 'ApprovalRule', 'Organisation'].map((x) => <option key={x}>{x}</option>)}</select></div>
      {list.loading ? <Spinner /> : list.error ? <Alert>{list.error}</Alert> : list.data.data.length === 0 ? <Empty>No entries.</Empty> : <div className="scroll"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Record</th><th /></tr></thead><tbody>
        {list.data.data.map((a: any) => <Fragment key={a.seq}><tr><td className="mono">{a.seq}</td><td>{fmtDateTime(a.at)}</td><td>{a.actor_name}</td><td>{a.action}</td><td className="muted">{a.entity_type} <span className="mono">{String(a.entity_id || '').slice(-6)}</span></td><td><Btn className="sm" onClick={() => setOpen(open === a.seq ? null : a.seq)}>{open === a.seq ? 'Hide' : 'Details'}</Btn></td></tr>
          {open === a.seq && <tr><td colSpan={6}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify({ before: a.old_values, after: a.new_values, metadata: a.metadata, ip: a.ip, hash: a.hash }, null, 2)}</pre></td></tr>}</Fragment>)}</tbody></table></div>}
      {list.data && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}</Card></Page>;
}
