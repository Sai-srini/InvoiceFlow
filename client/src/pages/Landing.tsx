import { Link } from 'react-router-dom';

/* Public front page. It only states what the application actually does; there are no customer logos or
   claims about results. Access is by invitation, so the single call to action is "Sign in". */
const STEPS: [string, string, string][] = [
  ['01', 'Capture', 'Upload invoice PDFs or key them in. Text is read from PDFs and every field is checked by a person before it becomes an invoice.'],
  ['02', 'Approve', 'Rules choose approvers by amount, department and cost centre. Nobody approves their own work, and limits must cover the whole invoice.'],
  ['03', 'Pay', 'Prepare a payment run; a different person releases it. InvoiceFlow produces the bank file. It does not move money.'],
  ['04', 'Reconcile', 'Import the bank statement and match it to payments. Paid means the bank shows it, not that a file was made.'],
  ['05', 'Report', 'Ageing, cash needed per week, vendor spend, approval turnaround and TDS, computed from your own data.'],
  ['06', 'Audit', 'Every change is recorded in a chained log, and the chain can be verified at any time.'],
];

export default function Landing() {
  return <div className="land">
    <header className="land-top"><div className="brand"><i>IF</i>InvoiceFlow</div><Link className="btn primary" to="/login">Sign in</Link></header>
    <section className="land-hero">
      <div className="eyebrow">Accounts payable and financial workflow</div>
      <h1>Accounts payable, under control.</h1>
      <p>InvoiceFlow takes a supplier invoice from capture to bank reconciliation, with approvals, separation of duties and an audit trail at every step.</p>
      <div className="row"><Link className="btn primary" to="/login">Sign in</Link><span className="muted">Access is by invitation from your administrator.</span></div>
    </section>
    <section className="land-grid" aria-label="How it works">{STEPS.map(([n, t, d]) => <article key={n}><div className="mono">{n}</div><h2>{t}</h2><p>{d}</p></article>)}</section>
    <footer className="land-foot"><span>InvoiceFlow</span><span>Prepares payment files only. No bank transfers are made by the application.</span></footer>
  </div>;
}
