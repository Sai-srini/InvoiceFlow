import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot';
import { makeWorld, World, ok, makeVendor, setupTaxAndRules, invoiceBody, addUser, gstin } from '../helpers/world';
import { Vendor, Invoice } from '../../models';

let app: Awaited<ReturnType<typeof boot>>; let w: World; let vendor: string;
before(async () => { app = await boot(); w = await makeWorld(app.base); await setupTaxAndRules(w); vendor = await makeVendor(w); });
after(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);

test('vendors: proposed vendors start pending; bank numbers are encrypted and masked everywhere', async () => {
  const v = ok(await acc().post('/vendors', { name: 'Marina Logistics Pvt Ltd', gstin: gstin('29BBBBB1111B1Z'), bank: { account_name: 'Marina Logistics', account_number: '9876543210', ifsc: 'ICIC0004321' } }), 201);
  assert.equal(v.status, 'pending_approval'); assert.equal(v.bank.account_masked, '••••3210');
  assert.ok(!JSON.stringify(v).includes('9876543210'));
  const raw: any = await Vendor.findOne({ _id: v.id, organisation_id: w.orgId }).lean();
  assert.ok(!JSON.stringify(raw).includes('9876543210')); assert.match(raw.bank.account_number_enc, /^v1:/);
  const list = ok(await w.c(w.approver1.token).get('/vendors'));
  assert.ok(!JSON.stringify(list).includes('987654321'));
  assert.equal((await w.c(w.requester.token).get('/vendors')).status, 403);
});
test('vendors: invalid tax and bank identifiers are rejected', async () => {
  assert.equal((await acc().post('/vendors', { name: 'Bad Gst Co', gstin: '33AAAAA0000A1ZZ' })).status, 400);
  assert.equal((await acc().post('/vendors', { name: 'Bad Pan Co', pan: 'NOTAPAN' })).status, 400);
  assert.equal((await acc().post('/vendors', { name: 'Bad Ifsc Co', bank: { account_name: 'x y', account_number: '123456789', ifsc: 'BAD' } })).status, 400);
});
test('vendors: only people with the permission can approve, and never their own proposal', async () => {
  const v = ok(await acc().post('/vendors', { name: 'Needs Approval Co', gstin: gstin('27AAPFU0939F1Z') }), 201);
  assert.equal((await acc().post(`/vendors/${v.id}/approve`, {})).status, 403);
  const role = ok(await w.c(w.admin.token).post('/roles', { name: 'Vendor Both', permissions: ['vendor.view', 'vendor.propose', 'vendor.approve'] }), 201);
  const both = await addUser(app.base, w.admin.token, role.id, 'both@kaveri.test', 'Both Hats');
  const mine = ok(await w.c(both.token).post('/vendors', { name: 'My Own Vendor' }), 201);
  const r = await w.c(both.token).post(`/vendors/${mine.id}/approve`, {});
  assert.equal(r.status, 403); assert.equal(r.body.code, 'SOD_VIOLATION'); assert.equal(r.body.details.rule, 'proposer_cannot_approve');
  ok(await w.c(w.head1.token).post(`/vendors/${mine.id}/approve`, {}));
});
test('vendors: bank changes need a second person; reveal needs its own permission and is audited', async () => {
  const before: any = await Vendor.findOne({ _id: vendor, organisation_id: w.orgId }).lean();
  const ch = ok(await acc().post(`/vendors/${vendor}/bank-changes`, { reason: 'Vendor moved bank', bank: { account_name: 'Kaveri Packaging', account_number: '555500001111', ifsc: 'SBIN0001234' } }), 201);
  assert.equal((await acc().post(`/vendors/bank-changes/${ch.id}/approve`, {})).status, 403);
  const same: any = await Vendor.findOne({ _id: vendor, organisation_id: w.orgId }).lean(); assert.equal(same.bank.account_last4, before.bank.account_last4); // not applied yet
  ok(await w.c(w.head1.token).post(`/vendors/bank-changes/${ch.id}/approve`, {}));
  assert.equal(ok(await w.c(w.head1.token).get(`/vendors/${vendor}`)).bank.account_masked, '••••1111');
  assert.equal((await acc().post(`/vendors/${vendor}/reveal-bank`, {})).status, 403);
  assert.equal(ok(await w.c(w.head1.token).post(`/vendors/${vendor}/reveal-bank`, {})).account_number, '555500001111');
  const audit = ok(await w.c(w.head1.token).get('/audit?action=vendor.bank_revealed')); assert.ok(audit.total >= 1);
  ok(await acc().post(`/vendors/${vendor}/bank-changes`, { reason: 'Switch back to original', bank: { account_name: 'Kaveri Packaging Works', account_number: '123456789012', ifsc: 'HDFC0001234' } }), 201);
  const pend = ok(await w.c(w.head1.token).get('/vendors/bank-changes')); ok(await w.c(w.head1.token).post(`/vendors/bank-changes/${pend[0].id}/approve`, {}));
});
test('invoices: money is integer paise, totals must add up, TDS comes from organisation settings', async () => {
  assert.equal((await acc().post('/invoices', { ...invoiceBody(vendor, 'BAD-1', 38500000), total_minor: 45000000 })).body.code, 'TOTAL_MISMATCH');
  assert.equal((await acc().post('/invoices', { ...invoiceBody(vendor, 'BAD-2', 38500000), subtotal_minor: 100.5 })).status, 400);
  assert.equal((await acc().post('/invoices', { ...invoiceBody(vendor, 'BAD-3', 38500000), line_items: [{ description: 'x', amount_minor: 1 }] })).body.code, 'LINES_MISMATCH');
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'INV-2291', 38500000, { line_items: [{ description: 'Cartons', amount_minor: 24000000 }, { description: 'Film', amount_minor: 14500000 }] })), 201);
  assert.equal(inv.status, 'draft'); assert.equal(inv.total_minor, 45430000); assert.equal(inv.tds_minor, 385000); assert.equal(inv.net_payable_minor, 45045000); assert.equal(inv.tds_section, 'TEST1');
  assert.ok(Number.isInteger(inv.total_minor));
});
test('invoices: duplicates are blocked or need a recorded reason', async () => {
  assert.equal((await acc().post('/invoices', invoiceBody(vendor, 'inv 2291', 38500000))).body.code, 'DUPLICATE_INVOICE_NUMBER'); // normalised: same number
  const sim = await acc().post('/invoices', invoiceBody(vendor, 'INV-2292', 38500000));
  assert.equal(sim.status, 409); assert.equal(sim.body.code, 'POSSIBLE_DUPLICATE');
  const okInv = ok(await acc().post('/invoices', invoiceBody(vendor, 'INV-2292', 38500000, { duplicate_override_reason: 'Second consignment confirmed with vendor' })), 201);
  assert.equal(okInv.duplicate_override.reason, 'Second consignment confirmed with vendor');
});
test('approval: no generic status endpoint exists; unmatched invoices cannot be submitted', async () => {
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'T-1', 1000000)), 201);
  assert.equal((await acc().post(`/invoices/${inv.id}/transition`, { status: 'approved' })).status, 404);
  const pendingVendor = ok(await acc().post('/vendors', { name: 'Not Yet Active' }), 201);
  const d2 = ok(await acc().post('/invoices', invoiceBody(pendingVendor.id, 'PV-1', 1000000)), 201);
  assert.equal((await acc().post(`/invoices/${d2.id}/submit`)).body.code, 'VENDOR_NOT_ACTIVE');
});
test('approval: two-step sequential approval, limits and turn order are enforced', async () => {
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'BIG-1', 100000000)), 201); // total ₹11,80,000
  const s = ok(await acc().post(`/invoices/${inv.id}/submit`)); assert.equal(s.status, 'in_review'); assert.equal(s.rule_name, 'Large');
  const d = ok(await acc().get(`/invoices/${inv.id}`));
  const second = d.approval_steps[1].approver_id === w.head1.id ? w.head1 : w.head2;
  assert.equal(d.approval_steps[0].approver_name, 'Vikram Shah'); assert.ok([w.head1.id, w.head2.id].includes(d.approval_steps[1].approver_id)); // every approver covers the full amount, ascending limit
  assert.ok([403, 404].includes((await w.c(w.approver1.token).post(`/invoices/${inv.id}/approve`, {})).status));      // Priya's ₹5,00,000 limit < ₹11,80,000: not assigned
  const early = await w.c(second.token).post(`/invoices/${inv.id}/approve`, {});
  assert.equal(early.status, 409); assert.equal(early.body.code, 'NOT_YOUR_TURN');
  ok(await w.c(w.approver2.token).post(`/invoices/${inv.id}/approve`, { comment: 'Looks right' }));
  assert.equal(ok(await acc().get(`/invoices/${inv.id}`)).status, 'in_review');
  assert.equal((await w.c(w.approver2.token).post(`/invoices/${inv.id}/approve`, {})).status, 403);       // cannot approve twice
  const done = ok(await w.c(second.token).post(`/invoices/${inv.id}/approve`, {}));
  assert.equal(done.status, 'approved');
  assert.equal((await w.c((second === w.head1 ? w.head2 : w.head1).token).post(`/invoices/${inv.id}/approve`, {})).status, 409);           // already approved
});
test('approval: creators cannot approve their own invoices even with both permissions', async () => {
  const role = ok(await w.c(w.admin.token).post('/roles', { name: 'Maker Checker', permissions: ['invoice.create', 'invoice.edit_before_approval', 'invoice.approve', 'invoice.view_all'] }), 201);
  const mc = await addUser(app.base, w.admin.token, role.id, 'mc@kaveri.test', 'Maker Checker', { approval_unlimited: true });
  const inv = ok(await w.c(mc.token).post('/invoices', invoiceBody(vendor, 'MC-1', 1230000)), 201);
  const sub = ok(await w.c(mc.token).post(`/invoices/${inv.id}/submit`));
  const steps = ok(await w.c(mc.token).get(`/invoices/${inv.id}`)).approval_steps;
  assert.ok(!steps.some((x: any) => x.approver_id === mc.id)); // never assigned to the creator
  const r = await w.c(mc.token).post(`/invoices/${inv.id}/approve`, {}); assert.equal(r.status, 403); assert.equal(r.body.code, 'SOD_VIOLATION');
  assert.equal(sub.status, 'in_review');
});
test('approval: reject needs a reason, hold raises a query, resume and reopen work, resubmission starts a new round', async () => {
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'H-1', 2000000)), 201);
  ok(await acc().post(`/invoices/${inv.id}/submit`));
  const ap = w.c(w.approver1.token);
  assert.equal((await ap.post(`/invoices/${inv.id}/hold`, { reason: 'x' })).status, 400);
  const held = ok(await ap.post(`/invoices/${inv.id}/hold`, { reason: 'PO number missing on the invoice' })); assert.equal(held.status, 'on_hold');
  assert.equal((await ap.post(`/invoices/${inv.id}/approve`, {})).status, 409);
  ok(await acc().post(`/invoices/${inv.id}/resume`, { response: 'PO 4471 added' }));
  assert.equal((await ap.post(`/invoices/${inv.id}/reject`, { reason: 'no' })).status, 400);
  const rej = ok(await ap.post(`/invoices/${inv.id}/reject`, { reason: 'Rate does not match the contract' })); assert.equal(rej.status, 'rejected');
  assert.equal((await acc().put(`/invoices/${inv.id}`, { description: 'x' })).status, 409);
  ok(await acc().post(`/invoices/${inv.id}/reopen`));
  ok(await acc().put(`/invoices/${inv.id}`, { description: 'Corrected rate' }));
  ok(await acc().post(`/invoices/${inv.id}/submit`));
  const d = ok(await acc().get(`/invoices/${inv.id}`)); assert.equal(d.status, 'in_review');
  assert.ok(d.comments.some((c: any) => c.kind === 'query')); assert.ok(d.comments.some((c: any) => c.kind === 'response'));
  assert.equal(new Set(d.approval_steps.map((s: any) => s.round)).size, 2);
});
test('approval: editing an invoice on hold cancels its approvals and returns it to draft', async () => {
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'H-2', 3000000)), 201);
  ok(await acc().post(`/invoices/${inv.id}/submit`));
  ok(await w.c(w.approver1.token).post(`/invoices/${inv.id}/hold`, { reason: 'Quantity looks wrong, please check' }));
  const e = ok(await acc().put(`/invoices/${inv.id}`, invoiceBody(vendor, 'H-2', 2500000))); assert.equal(e.status, 'draft');
  const steps = ok(await acc().get(`/invoices/${inv.id}`)).approval_steps; assert.ok(steps.every((s: any) => s.status === 'cancelled'));
});
test('approval: delegation lets a delegate act, and records who acted for whom', async () => {
  const inv = ok(await acc().post('/invoices', invoiceBody(vendor, 'D-1', 1500000)), 201);
  ok(await acc().post(`/invoices/${inv.id}/submit`));
  const first = ok(await acc().get(`/invoices/${inv.id}`)).approval_steps[0];
  const owner = first.approver_name === 'Priya Nair' ? w.approver1 : first.approver_name === 'Vikram Shah' ? w.approver2 : w.head1;
  const delegate = owner.id === w.head2.id ? w.head1 : w.head2;
  assert.equal((await w.c(delegate.token).post(`/invoices/${inv.id}/approve`, {})).status, 403);
  const now = Date.now();
  ok(await w.c(owner.token).post('/delegations', { to_user: delegate.id, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 86400000).toISOString() }), 201);
  const q = ok(await w.c(delegate.token).get('/approvals/queue?bucket=waiting')); assert.ok(q.some((i: any) => i.id === inv.id));
  ok(await w.c(delegate.token).post(`/invoices/${inv.id}/approve`, {}));
  const d = ok(await acc().get(`/invoices/${inv.id}`)); const st = d.approval_steps.find((s: any) => s.status === 'approved'); assert.equal(st.acted_by_name, delegate === w.head2 ? 'Meera Rao' : 'Anil Kapoor');
});
test('visibility: requesters see only their own invoices; approvers only assigned ones', async () => {
  const mine = ok(await w.c(w.requester.token).post('/invoices', invoiceBody(vendor, 'REQ-1', 500000)), 201);
  const list = ok(await w.c(w.requester.token).get('/invoices')); assert.ok(list.data.every((i: any) => i.created_by === w.requester.id)); assert.ok(list.data.some((i: any) => i.id === mine.id));
  const other: any = await Invoice.findOne({ organisation_id: w.orgId, number: 'INV-2291' }).lean();
  assert.equal((await w.c(w.requester.token).get(`/invoices/${other._id}`)).status, 404);
  const big: any = await Invoice.findOne({ organisation_id: w.orgId, number: 'BIG-1' }).lean();
  assert.equal((await w.c(w.approver1.token).get(`/invoices/${big._id}`)).status, 404);   // Priya was never assigned to it
  const pg = ok(await acc().get('/invoices?limit=3&page=1')); assert.equal(pg.data.length, 3); assert.ok(pg.total > 3);
});
test('approval rules: validated, org-scoped and audited', async () => {
  assert.equal((await w.c(w.head1.token).post('/approval-rules', { name: 'Bad', min_minor: 100, max_minor: 50, approvers_required: 1, mode: 'parallel' })).status, 400);
  assert.equal((await acc().post('/approval-rules', { name: 'Nope', min_minor: 0, approvers_required: 1, mode: 'parallel' })).status, 403);
  const rules = ok(await w.c(w.head1.token).get('/approval-rules')); assert.ok(rules.length >= 2);
});
