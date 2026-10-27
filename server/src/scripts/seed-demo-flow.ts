/**
 * DEVELOPMENT ONLY. Fills a seeded database with a realistic spread of vendors, invoices, approvals and one
 * payment run, so the dashboard and report charts show real rows. It uses the real HTTP API of a running server
 * (so every rule, permission check and audit entry applies) and the demo users created by `npm run seed`.
 *
 *   SEED_PASSWORD=<same as seed> API_BASE=http://localhost:3001/api npm run seed:demo
 *
 * Nothing here is a mock: the numbers the charts draw are computed by the report service from these database rows.
 */
import { gstinCheckChar } from '../lib/validators';

const BASE = process.env.API_BASE || 'http://localhost:3001/api';
const PW = process.env.SEED_PASSWORD || '';
if (!PW) { console.error('Set SEED_PASSWORD to the password used for `npm run seed`.'); process.exit(1); }
if (process.env.NODE_ENV === 'production') { console.error('Refusing to run in production.'); process.exit(1); }

async function call(token: string | null, method: string, path: string, body?: any) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const text = await r.text(); let json: any = text; try { json = JSON.parse(text); } catch { /* keep text */ }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
const login = async (email: string) => { const r = await call(null, 'POST', '/auth/login', { email, password: PW }); return { token: r.access_token as string, id: r.user.id as string }; };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const gst = (first14: string) => first14 + gstinCheckChar(first14);

async function main() {
  const acc = await login('accounts@demo.test'); const head = await login('head@demo.test'); const head2 = await login('head2@demo.test');
  const ap1 = await login('approver@demo.test'); const ap2 = await login('approver2@demo.test');
  const byId: Record<string, string> = { [acc.id]: acc.token, [head.id]: head.token, [head2.id]: head2.token, [ap1.id]: ap1.token, [ap2.id]: ap2.token };

  // Vendors: proposed by Accounts, approved by a different person (Finance Head).
  const vendorDefs = [
    { name: 'Chennai Cloud Services Pvt Ltd', g: '33BBBBB1111B1Z', cat: 'IT', acct: '223344556677' },
    { name: 'Sri Lakshmi Logistics', g: '33CCCCC2222C1Z', cat: 'Freight', acct: '334455667788' },
    { name: 'Apex Office Supplies', g: '33DDDDD3333D1Z', cat: 'Office', acct: '445566778899' },
    { name: 'Madras Facility Management', g: '33EEEEE4444E1Z', cat: 'Facilities', acct: '556677889900' },
  ];
  const existing = await call(head.token, 'GET', '/vendors?limit=100');
  const vendorIds: string[] = existing.data.filter((v: any) => v.status === 'active').map((v: any) => v.id);
  for (const d of vendorDefs) {
    const have = existing.data.find((v: any) => v.name === d.name);
    if (have) { if (have.status === 'active') continue; await call(head.token, 'POST', `/vendors/${have.id}/approve`); vendorIds.push(have.id); continue; }
    const v = await call(acc.token, 'POST', '/vendors', { name: d.name, gstin: gst(d.g), category: d.cat, payment_terms_days: 30, tds_section: 'DEMO',
      bank: { account_name: d.name, account_number: d.acct, ifsc: 'HDFC0001234', bank_name: 'Demo Bank' } });
    await call(head.token, 'POST', `/vendors/${v.id}/approve`); vendorIds.push(v.id);
  }
  if (vendorIds.length === 0) throw new Error('No active vendors. Run `npm run seed` first.');

  // Invoices spread across due dates (overdue, this week, later) and sizes (1 or 2 approval steps).
  const specs: { amount: number; due: number; fate: 'review' | 'approved' | 'paid_run' }[] = [
    { amount: 8_000_000, due: -12, fate: 'approved' }, { amount: 4_500_000, due: -40, fate: 'approved' }, { amount: 25_000_000, due: 3, fate: 'approved' },
    { amount: 12_000_000, due: 9, fate: 'approved' }, { amount: 60_000_000, due: 16, fate: 'approved' }, { amount: 9_500_000, due: 23, fate: 'review' },
    { amount: 31_000_000, due: 30, fate: 'review' }, { amount: 15_000_000, due: 5, fate: 'paid_run' }, { amount: 6_000_000, due: 2, fate: 'paid_run' },
  ];
  const stamp = Date.now().toString().slice(-6); const forRun: string[] = []; let n = 0;
  for (const s of specs) {
    n++;
    const vendor = vendorIds[n % vendorIds.length]; const tax = Math.round(s.amount * 0.09);
    const inv = await call(acc.token, 'POST', '/invoices', { number: `DEMO-${stamp}-${n}`, vendor_id: vendor, invoice_date: day(-50), due_date: day(s.due),
      subtotal_minor: s.amount, cgst_minor: tax, sgst_minor: tax, total_minor: s.amount + 2 * tax, department: 'Operations' });
    await call(acc.token, 'POST', `/invoices/${inv.id}/submit`);
    if (s.fate === 'review') continue;
    let detail = await call(acc.token, 'GET', `/invoices/${inv.id}`);
    for (const step of [...detail.approval_steps].sort((a: any, b: any) => a.step_order - b.step_order)) await call(byId[step.approver_id], 'POST', `/invoices/${inv.id}/approve`);
    detail = await call(acc.token, 'GET', `/invoices/${inv.id}`);
    if (detail.status === 'approved' && s.fate === 'paid_run') forRun.push(inv.id);
  }
  if (forRun.length) {
    const run = await call(acc.token, 'POST', '/payment-runs', { invoice_ids: forRun, pay_date: day(1), notes: 'Demo run' });
    await call(head.token, 'POST', `/payment-runs/${run.id}/release`);   // a different person releases; this only produces a CSV, no money moves
    console.log(`Released payment run ${run.number} (file generated; no bank transfer).`);
  }
  console.log(`Done: ${n} invoices created. Open the Dashboard and Reports to see real charts.`);
}
main().catch((e) => { console.error('Seed demo failed:', e.message); process.exit(1); });
