import { Link } from 'react-router-dom';
import { BarsChart, MixBar } from '../components/charts';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../lib/hooks';
import { Alert, Card, Page, Spinner, Badge } from '../components/ui';
import { formatMinor, label } from '../lib/format';

export default function Dashboard() {
  const { user, canAny } = useAuth();
  const d = useApi<any>('/reports/dashboard');
  const showFlow = canAny('report.view_ops', 'report.view_all');
  const flow = useApi<any[]>(showFlow ? '/reports/cash-flow' : null);
  if (d.loading) return <Spinner />;
  if (d.error) return <div className="page"><Alert>{d.error}</Alert></div>;
  const x = d.data; const by = x.invoices_by_status || {};
  const total = (k: string) => by[k]?.count || 0;
  return <Page title={`Hello, ${user?.full_name.split(' ')[0]}`} sub="Overview">
    <div className="grid g4">
      {canAny('invoice.approve', 'invoice.reject') && <div className="stat"><div className="eyebrow">Waiting for your approval</div><b>{x.awaiting_my_approval}</b><small><Link to="/approvals">Open approvals</Link></small></div>}
      <div className="stat"><div className="eyebrow">In review</div><b>{total('in_review')}</b><small>{formatMinor(by.in_review?.total_minor || 0)}</small></div>
      <div className="stat"><div className="eyebrow">Approved, not yet paid</div><b>{total('approved') + total('scheduled') + total('released')}</b><small>{formatMinor((by.approved?.total_minor || 0) + (by.scheduled?.total_minor || 0) + (by.released?.total_minor || 0))}</small></div>
      <div className="stat"><div className="eyebrow">Overdue</div><b style={{ color: x.overdue.count ? 'var(--red)' : undefined }}>{x.overdue.count}</b><small>{formatMinor(x.overdue.total_minor)}</small></div>
      <div className="stat"><div className="eyebrow">Paid or reconciled</div><b>{total('paid') + total('reconciled')}</b><small>{total('reconciled')} reconciled</small></div>
      <div className="stat"><div className="eyebrow">Avg approval time</div><b>{x.avg_approval_hours === null ? '—' : `${x.avg_approval_hours} h`}</b><small>{x.approvals_measured} decisions measured</small></div>
      {x.open_exceptions !== null && <div className="stat"><div className="eyebrow">Statement lines to review</div><b>{x.open_exceptions}</b><small><Link to="/reconciliation">Open reconciliation</Link></small></div>}
    </div>
    <div className="grid g2">
      <Card title="Invoices by status">{Object.keys(by).length === 0 ? <div className="muted">No invoices yet.</div> : <>
        <MixBar summary={`Invoices by status: ${Object.entries<any>(by).map(([k, v]) => `${v.count} ${label(k)}`).join(', ')}`}
          parts={Object.entries<any>(by).map(([k, v]) => ({ name: label(k), value: v.count, tone: ['rejected', 'on_hold'].includes(k) ? 'red' : k === 'paid' ? 'grey' : k === 'reconciled' ? 'light' : ['approved', 'scheduled', 'released'].includes(k) ? 'mid' : 'ink' }))} />
        <table style={{ marginTop: 16 }}><tbody>{Object.entries<any>(by).map(([k, v]) => <tr key={k}><td><Badge status={k} /></td><td className="num">{v.count}</td><td className="num">{formatMinor(v.total_minor)}</td></tr>)}</tbody></table></>}</Card>
      {showFlow && <Card title="Cash needed per week (by due date)">{flow.loading ? <Spinner /> : flow.error ? <Alert>{flow.error}</Alert> :
        <BarsChart summary={`Cash needed per week: ${(flow.data || []).map((w) => `${w.label} ${formatMinor(w.total_minor)}`).join('; ')}`}
          data={(flow.data || []).map((w, i) => ({ name: w.week === 0 ? 'Now' : `+${w.week}w`, value: w.total_minor, hot: w.week === 0 && w.total_minor > 0 }))} />}</Card>}
    </div>
  </Page>;
}
