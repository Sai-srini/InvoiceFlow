import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { openFile } from '../lib/api';
import { errMsg, useApi } from '../lib/hooks';
import { Alert, Badge, Btn, Card, Empty, Page, Spinner, Tabs, useToast } from '../components/ui';
import { BarsChart, HBars, MixBar } from '../components/charts';
import { fmtDate, formatMinor, label } from '../lib/format';

const REPORTS = [
  { key: 'aging', label: 'AP aging', perms: ['report.view_ops', 'report.view_all'], csv: true },
  { key: 'payments-due', label: 'Payments due', perms: ['report.view_ops', 'report.view_all'], csv: true },
  { key: 'cash-flow', label: 'Cash-flow forecast', perms: ['report.view_ops', 'report.view_all'] },
  { key: 'vendor-spend', label: 'Vendor spend', perms: ['report.view_all', 'report.view_ops'], csv: true },
  { key: 'approval-turnaround', label: 'Approval turnaround', perms: ['report.view_all', 'report.view_ops'] },
  { key: 'tds', label: 'TDS summary', perms: ['report.view_all'], csv: true },
  { key: 'reconciliation', label: 'Reconciliation status', perms: ['report.view_all', 'bank.view'] },
];

function Table({ cols, rows }: { cols: { h: string; f: (r: any) => any; num?: boolean }[]; rows: any[] }) {
  if (!rows.length) return <Empty>No data for this report yet.</Empty>;
  return <div className="scroll"><table><thead><tr>{cols.map((c) => <th key={c.h} className={c.num ? 'num' : ''}>{c.h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.h} className={c.num ? 'num' : ''}>{c.f(r)}</td>)}</tr>)}</tbody></table></div>;
}

function Body({ k }: { k: string }) {
  const d = useApi<any>(`/reports/${k}`);
  if (d.loading) return <Spinner />; if (d.error) return <Alert>{d.error}</Alert>;
  const x = d.data;
  if (k === 'aging') return <><div className="card-b"><BarsChart summary={`AP aging: ${Object.entries<any>(x.buckets).map(([b, v]) => `${b} ${formatMinor(v.total_minor)}`).join('; ')}`}
      data={Object.entries<any>(x.buckets).map(([b, v]) => ({ name: b === 'current' ? 'Not yet due' : `${b} days`, value: v.total_minor, hot: b !== 'current' && v.total_minor > 0, muted: b === 'current' }))} /></div><div className="grid g4" style={{ padding: 14 }}>{Object.entries<any>(x.buckets).map(([b, v]) => <div className="stat" key={b}><div className="eyebrow">{b === 'current' ? 'Not yet due' : `${b} days overdue`}</div><b>{formatMinor(v.total_minor)}</b><small>{v.count} invoice(s)</small></div>)}</div>
    <Table rows={x.rows} cols={[{ h: 'Invoice', f: (r) => <span className="mono">{r.number}</span> }, { h: 'Vendor', f: (r) => r.vendor_name }, { h: 'Status', f: (r) => <Badge status={r.status} /> }, { h: 'Due', f: (r) => fmtDate(r.due_date) }, { h: 'Bucket', f: (r) => r.bucket }, { h: 'Net payable', f: (r) => formatMinor(r.net_payable_minor), num: true }]} /></>;
  if (k === 'payments-due') return <Table rows={x} cols={[{ h: 'Invoice', f: (r) => <span className="mono">{r.number}</span> }, { h: 'Vendor', f: (r) => r.vendor_name }, { h: 'Status', f: (r) => <Badge status={r.status} /> }, { h: 'Due', f: (r) => fmtDate(r.due_date) }, { h: 'Net payable', f: (r) => formatMinor(r.net_payable_minor), num: true }]} />;
  if (k === 'cash-flow') return <><div className="card-b"><BarsChart summary={`Cash needed: ${x.map((r: any) => `${r.label} ${formatMinor(r.total_minor)}`).join('; ')}`} data={x.map((r: any, i: number) => ({ name: r.week === 0 ? 'Now' : `+${r.week}w`, value: r.total_minor, hot: r.week === 0 && r.total_minor > 0 }))} /></div><Table rows={x} cols={[{ h: 'Period', f: (r) => r.label }, { h: 'Invoices', f: (r) => r.count, num: true }, { h: 'Cash needed', f: (r) => formatMinor(r.total_minor), num: true }]} /></>;
  if (k === 'vendor-spend') return <><div className="card-b"><div className="eyebrow" style={{ marginBottom: 8 }}>Top {Math.min(10, x.length)} vendors by total invoiced</div><HBars summary={`Top vendors by spend: ${x.slice(0, 10).map((r: any) => `${r.vendor_name} ${formatMinor(r.total_minor)}`).join('; ')}`} data={[...x].sort((a: any, b: any) => b.total_minor - a.total_minor).slice(0, 10).map((r: any, i: number) => ({ name: r.vendor_name || 'Unknown vendor', value: r.total_minor, hot: i === 0 }))} /></div><Table rows={x} cols={[{ h: 'Vendor', f: (r) => r.vendor_name }, { h: 'Invoices', f: (r) => r.invoice_count, num: true }, { h: 'Total', f: (r) => formatMinor(r.total_minor), num: true }, { h: 'Average', f: (r) => formatMinor(r.average_minor), num: true }]} /></>;
  if (k === 'approval-turnaround') return <><div className="card-b"><div className="eyebrow" style={{ marginBottom: 8 }}>Average hours to decide, per approver</div><HBars money={false} unit=" h" summary={`Approval turnaround in hours: ${x.map((r: any) => `${r.approver_name} ${r.avg_hours}`).join('; ')}`} data={[...x].sort((a: any, b: any) => b.avg_hours - a.avg_hours).map((r: any, i: number) => ({ name: r.approver_name || 'Unknown user', value: Number(r.avg_hours) || 0, hot: i === 0 && Number(r.avg_hours) > 24 }))} /></div><Table rows={x} cols={[{ h: 'Approver', f: (r) => r.approver_name }, { h: 'Decisions', f: (r) => r.decisions, num: true }, { h: 'Average hours', f: (r) => r.avg_hours, num: true }, { h: 'Approved / rejected', f: (r) => `${r.approved} / ${r.rejected}`, num: true }, { h: 'Waiting now', f: (r) => r.pending, num: true }]} /></>;
  if (k === 'tds') return <><div className="card-b"><div className="eyebrow" style={{ marginBottom: 8 }}>TDS deducted by section</div><BarsChart summary={`TDS by section: ${x.by_section.map((r: any) => `${r.section} ${formatMinor(r.tds_minor)}`).join('; ')}`} data={x.by_section.map((r: any) => ({ name: r.section === 'unspecified' ? 'No section' : r.section, value: r.tds_minor }))} /></div><Table rows={x.by_section} cols={[{ h: 'Section', f: (r) => r.section }, { h: 'Invoices', f: (r) => r.count, num: true }, { h: 'Taxable value', f: (r) => formatMinor(r.taxable_minor), num: true }, { h: 'TDS', f: (r) => formatMinor(r.tds_minor), num: true }]} />
    <div className="card-b"><small className="muted">TDS uses the rates in Settings, which your accountant must confirm. This report is a working summary, not a filing.</small></div></>;
  return <div className="card-b"><div className="eyebrow" style={{ marginBottom: 8 }}>Bank statement lines by outcome</div>
    <MixBar summary={`Statement lines: ${Object.entries<any>(x.lines).map(([s, v]) => `${v.count} ${label(s)}`).join(', ')}`} parts={Object.entries<any>(x.lines).map(([s, v]) => ({ name: label(s), value: v.count, tone: s === 'exception' ? 'red' : s === 'matched' ? 'ink' : s === 'unmatched' ? 'grey' : 'mid' }))} />
    <div className="grid g4" style={{ marginTop: 24 }}>{Object.entries<any>(x.lines).map(([s, v]) => <div className="stat" key={s}><div className="eyebrow">{label(s)}</div><b>{v.count}</b><small>{formatMinor(v.debit_minor)} debits</small></div>)}
    <div className="stat"><div className="eyebrow">Payments reconciled</div><b>{x.payments.reconciled.n}</b><small>{formatMinor(x.payments.reconciled.net)}</small></div><div className="stat"><div className="eyebrow">Payments not reconciled</div><b>{x.payments.unreconciled.n}</b><small>{formatMinor(x.payments.unreconciled.net)}</small></div></div></div>;
}

export default function Reports() {
  const { canAny, can } = useAuth(); const toast = useToast(); const tabs = REPORTS.filter((r) => canAny(...r.perms)); const [k, setK] = useState(tabs[0]?.key || 'aging');
  const cur = tabs.find((t) => t.key === k) || tabs[0];
  if (!cur) return <Page title="Reports"><Alert kind="info">No reports are available for your role.</Alert></Page>;
  return <Page title="Reports" sub="Computed live from your data" actions={<>
    {cur.csv && <Btn onClick={() => openFile(`/reports/${cur.key}?format=csv`, { download: `${cur.key}.csv` }).catch((e) => toast(errMsg(e), 'error'))}>Export CSV</Btn>}
    {can('report.view_all') && <Btn onClick={() => openFile('/reports/journal-export', { download: 'journal-export.csv' }).catch((e) => toast(errMsg(e), 'error'))}>Journal export (CSV)</Btn>}</>}>
    <Tabs value={cur.key} onChange={setK} tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} /><Card pad={false}><Body key={cur.key} k={cur.key} /></Card></Page>;
}
