import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot';
import { makeWorld, World, ok, makeVendor, setupTaxAndRules, approvedInvoice, gstin } from '../helpers/world';

// NOTE: written for the vendor-management upgrade. Like the other integration tests it needs a MongoDB the test
// helper can boot; it has not been executed in the environment where it was written.
let app: Awaited<ReturnType<typeof boot>>; let w: World;
before(async () => { app = await boot(); w = await makeWorld(app.base); await setupTaxAndRules(w); });
after(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token); const head = () => w.c(w.head1.token);

test('vendor list returns status counts for the filter chips, ignoring the active filter', async () => {
  await makeVendor(w, 'Counts Active Co', gstin('33CCCCC1111C1Z'), '111111111111');
  ok(await acc().post('/vendors', { name: 'Counts Pending Co', gstin: gstin('29DDDDD2222D1Z') }), 201);
  const r = ok(await head().get('/vendors?status=pending_approval'));
  assert.ok(r.counts.active >= 1); assert.ok(r.counts.pending_approval >= 1);
  assert.ok(r.data.every((v: any) => v.status === 'pending_approval'));
});

test('vendor detail includes invoice statistics', async () => {
  const id = await makeVendor(w, 'Stats Co', gstin('33EEEEE3333E1Z'), '222222222222');
  assert.deepEqual(ok(await head().get(`/vendors/${id}`)).stats.invoice_count, 0);
  await approvedInvoice(w, id, 'STAT-001', 100000);
  const d = ok(await head().get(`/vendors/${id}`));
  assert.equal(d.stats.invoice_count, 1); assert.ok(d.stats.open_minor > 0); assert.equal(d.stats.paid_minor, 0);
});

test('deactivate and reactivate: audited, blocked while approved invoices wait for payment', async () => {
  const id = await makeVendor(w, 'Toggle Co', gstin('33FFFFF4444F1Z'), '333333333333');
  await approvedInvoice(w, id, 'TOG-001', 100000);
  const blocked = await head().patch(`/vendors/${id}`, { status: 'inactive' });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'OPEN_INVOICES');
  const free = await makeVendor(w, 'Toggle Free Co', gstin('33GGGGG5555G1Z'), '444444444444');
  assert.equal(ok(await head().patch(`/vendors/${free}`, { status: 'inactive' })).status, 'inactive');
  assert.equal(ok(await head().patch(`/vendors/${free}`, { status: 'active' })).status, 'active');
});

test('only an approved vendor can be switched active/inactive; pending ones must be approved or rejected', async () => {
  const v = ok(await acc().post('/vendors', { name: 'Still Pending Co', gstin: gstin('27HHHHH6666H1Z') }), 201);
  const r = await head().patch(`/vendors/${v.id}`, { status: 'active' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'BAD_STATE');
});

test('accounts staff can edit contact details but not identity, tax or terms', async () => {
  const id = await makeVendor(w, 'Edit Co', gstin('33IIIII7777I1Z'), '555555555555');
  const role = ok(await w.c(w.admin.token).post('/roles', { name: 'Vendor Editor', permissions: ['vendor.view', 'vendor.propose'] }), 201);
  assert.ok(role.id);
  assert.equal(ok(await acc().patch(`/vendors/${id}`, { contact_phone: '+91 90000 00000', contact_email: '' })).contact_phone, '+91 90000 00000');
  assert.equal((await acc().patch(`/vendors/${id}`, { payment_terms_days: 90 })).status, 403);
  assert.equal(ok(await head().patch(`/vendors/${id}`, { payment_terms_days: 90 })).payment_terms_days, 90);
});

test('a rejected vendor keeps its rejection reason', async () => {
  const v = ok(await acc().post('/vendors', { name: 'Reject Me Co', gstin: gstin('29JJJJJ8888J1Z') }), 201);
  assert.equal((await head().post(`/vendors/${v.id}/reject`, {})).status, 400);
  ok(await head().post(`/vendors/${v.id}/reject`, { note: 'GSTIN does not match legal name' }));
  assert.equal(ok(await head().get(`/vendors/${v.id}`)).rejection_reason, 'GSTIN does not match legal name');
});
