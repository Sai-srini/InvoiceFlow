import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { Alert, Badge, Card, Empty, Page, Spinner, Tabs } from '../components/ui';
import { fmtDate, formatMinor } from '../lib/format';
import { useAuth } from '../context/AuthContext';

export default function Approvals() {
  const [bucket, setBucket] = useState('waiting'); const nav = useNavigate(); const { user } = useAuth();
  const q = useApi<any[]>(`/approvals/queue?bucket=${bucket}`);
  return <Page title="Approvals" sub={user?.approval_unlimited ? 'Your approval limit: unlimited' : `Your approval limit: ${formatMinor(user?.approval_limit_minor ?? 0)} per invoice`}>
    <Tabs value={bucket} onChange={setBucket} tabs={[{ key: 'waiting', label: 'Waiting on you' }, { key: 'on_hold', label: 'On hold' }, { key: 'decided', label: 'Decided by you' }]} />
    <Card pad={false}>{q.loading ? <Spinner /> : q.error ? <Alert>{q.error}</Alert> : !q.data || q.data.length === 0 ? <Empty>Nothing here.</Empty> : <div className="scroll"><table>
      <thead><tr><th>Invoice</th><th>Vendor</th><th>Status</th><th>Due</th><th>Step</th><th className="num">Total</th><th>Within your limit</th></tr></thead>
      <tbody>{q.data.map((i) => <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}><td className="mono">{i.number}</td><td>{i.vendor_name}</td><td><Badge status={i.status} /></td><td>{fmtDate(i.due_date)}</td>
        <td>{i.step_order ? `${i.step_order} of ${i.steps_total}` : '—'}{bucket === 'waiting' && !i.my_turn ? ' (not yet your turn)' : ''}</td><td className="num">{formatMinor(i.total_minor)}</td><td>{i.within_limit ? <Badge status="approved" text="Yes" /> : <Badge status="rejected" text="No" />}</td></tr>)}</tbody></table></div>}</Card>
  </Page>;
}
