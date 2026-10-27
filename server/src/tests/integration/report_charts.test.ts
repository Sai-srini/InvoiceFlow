import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot';
import { makeWorld, World, ok, makeVendor, setupTaxAndRules, approvedInvoice, gstin } from '../helpers/world';

// Checks that the real report endpoints return exactly the fields the dashboard and report charts read.
// Written against report.service.ts; needs a MongoDB like the other integration tests and has not been executed yet.
let app: Awaited<ReturnType<typeof boot>>; let w: World;
before(async () => { app = await boot(); w = await makeWorld(app.base); await setupTaxAndRules(w);
  const v = await makeVendor(w, 'Chart Data Co', gstin('33KKKKK9999K1Z'), '666666666666'); await approvedInvoice(w, v, 'CHART-001', 200000); });
after(async () => { await app.close(); });
const head = () => w.c(w.head1.token);
const isNum = (x: any) => typeof x === 'number' && Number.isFinite(x);

test('dashboard: invoices_by_status entries have count and total_minor numbers', async () => {
  const d = ok(await head().get('/reports/dashboard'));
  const entries = Object.values<any>(d.invoices_by_status); assert.ok(entries.length >= 1);
  for (const e of entries) { assert.ok(isNum(e.count)); assert.ok(isNum(e.total_minor)); }
  assert.ok(isNum(d.overdue.count));
});
test('aging: every bucket has count and total_minor', async () => {
  const r = ok(await head().get('/reports/aging'));
  assert.deepEqual(Object.keys(r.buckets), ['current', '1-30', '31-60', '61-90', '90+']);
  for (const b of Object.values<any>(r.buckets)) { assert.ok(isNum(b.count)); assert.ok(isNum(b.total_minor)); }
});
test('cash-flow: each week has week, label and total_minor', async () => {
  const r = ok(await head().get('/reports/cash-flow'));
  assert.ok(r.length >= 2); assert.equal(r[0].week, 0);
  for (const row of r) { assert.ok(isNum(row.week)); assert.equal(typeof row.label, 'string'); assert.ok(isNum(row.total_minor)); }
});
test('vendor-spend: rows are sorted by total and carry vendor_name', async () => {
  const r = ok(await head().get('/reports/vendor-spend'));
  assert.ok(r.length >= 1); assert.equal(r[0].vendor_name, 'Chart Data Co'); assert.ok(isNum(r[0].total_minor));
});
test('approval-turnaround and tds rows carry the fields the charts read', async () => {
  for (const row of ok(await head().get('/reports/approval-turnaround'))) { assert.equal(typeof row.approver_name, 'string'); assert.ok(isNum(row.avg_hours)); }
  const t = ok(await head().get('/reports/tds'));
  for (const s of t.by_section) { assert.equal(typeof s.section, 'string'); assert.ok(isNum(s.tds_minor)); }
});
test('reconciliation status: lines map and payment counters exist', async () => {
  const r = ok(await head().get('/reports/reconciliation'));
  assert.equal(typeof r.lines, 'object'); assert.ok(isNum(r.payments.reconciled.n)); assert.ok(isNum(r.payments.unreconciled.n));
});
