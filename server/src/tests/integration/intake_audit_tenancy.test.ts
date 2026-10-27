import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { boot, makeTextPdf } from '../helpers/boot';
import { makeWorld, World, ok, makeVendor, setupTaxAndRules, VENDOR_GSTIN, gstin, PW } from '../helpers/world';
import { Invoice, AuditLog, ApprovalStep } from '../../models';
import { escalateOverdueSteps } from '../../services/approval.service';
import { createOrganisation } from '../../services/org.service';

let app: Awaited<ReturnType<typeof boot>>; let w: World; let vendor: string;
before(async () => { app = await boot(); w = await makeWorld(app.base); await setupTaxAndRules(w); vendor = await makeVendor(w); });
after(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);
const BUYER = gstin('29BBBBB1111B1Z');
const invoiceLines = [`Kaveri Packaging Works`, `TAX INVOICE`, `GSTIN: ${VENDOR_GSTIN}`, `Invoice No: INV-7788`, `Invoice Date: 09/10/2026`, `Due Date: 24-Oct-2026`, `Bill To: Kaveri Foods Pvt Ltd`, `GSTIN: ${BUYER}`,
  `Corrugated carton 8,000 2,40,000.00`, `Taxable Value 3,85,000.00`, `CGST @9% 34,650.00`, `SGST @9% 34,650.00`, `Grand Total Rs. 4,54,300.00`];
const form = (buf: Buffer, name: string) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); return fd; };
const post = (token: string, path: string, fd: FormData) => fetch(app.base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() as any }));

test('intake: files are checked by their real content, not their name', async () => {
  const fake = await post(w.accounts.token, '/intake/upload', form(Buffer.from('this is plain text, not a pdf'), 'invoice.pdf'));
  assert.equal(fake.status, 400); assert.equal(fake.body.code, 'INVALID_FILE');
  assert.equal((await post(w.accounts.token, '/intake/upload', form(Buffer.from('MZ\x90\x00 executable'), 'x.png'))).status, 400);
  assert.equal((await post(w.requester.token, '/intake/upload', form(makeTextPdf(invoiceLines), 'a.pdf'))).status, 403);
});
let intakeId: string;
test('intake: a real PDF is read, fields are extracted and validated, the vendor is matched by GSTIN', async () => {
  const up = await post(w.accounts.token, '/intake/upload', form(makeTextPdf(invoiceLines), 'kaveri-7788.pdf'));
  assert.equal(up.status, 201); intakeId = up.body.id;
  const d = ok(await acc().get(`/intake/${intakeId}`));
  assert.equal(d.status, 'extracted'); assert.equal(d.text_source, 'pdf_text');
  const f = d.extraction.fields;
  assert.equal(f.invoice_number.value, 'INV-7788'); assert.equal(f.invoice_date.value, '2026-10-09'); assert.equal(f.due_date.value, '2026-10-24');
  assert.equal(f.vendor_gstin.value, VENDOR_GSTIN); assert.equal(f.buyer_gstin.value, BUYER);
  assert.deepEqual([f.subtotal_minor.value, f.cgst_minor.value, f.sgst_minor.value, f.total_minor.value], [38500000, 3465000, 3465000, 45430000]);
  assert.equal(d.extraction.checks.find((c: any) => c.key === 'totals').status, 'pass');
  assert.equal(d.matched_vendor_id, vendor);
  const dup = await post(w.accounts.token, '/intake/upload', form(makeTextPdf(invoiceLines), 'kaveri-7788-copy.pdf'));
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'DUPLICATE_FILE');
});
test('intake: nothing is auto-submitted; the reviewer converts it to a DRAFT, and the document is stored privately', async () => {
  const bad = await acc().post(`/intake/${intakeId}/create-invoice`, { vendor_id: vendor, number: 'INV-7788', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45000000 });
  assert.equal(bad.body.code, 'TOTAL_MISMATCH');
  const r = ok(await acc().post(`/intake/${intakeId}/create-invoice`, { vendor_id: vendor, number: 'INV-7788', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45430000, department: 'Packaging' }), 201);
  assert.equal(r.submitted, false); assert.equal(r.invoice.status, 'draft'); assert.equal(r.invoice.has_file, true);
  assert.equal(ok(await acc().get(`/intake/${intakeId}`)).status, 'converted');
  const noAuth = await fetch(`${app.base}/invoices/${r.invoice.id}/file`); assert.equal(noAuth.status, 401);
  const withAuth = await fetch(`${app.base}/invoices/${r.invoice.id}/file`, { headers: { Authorization: `Bearer ${w.accounts.token}` } });
  assert.equal(withAuth.status, 200); assert.equal(withAuth.headers.get('content-type'), 'application/pdf'); assert.equal(withAuth.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${app.base}/invoices/${r.invoice.id}/file`, { headers: { Authorization: `Bearer ${w.requester.token}` } })).status, 404);  // cannot see others' invoices
  assert.equal((await post(w.accounts.token, '/intake/upload', form(makeTextPdf(invoiceLines), 'again.pdf'))).status, 409);                          // file now belongs to an invoice
});
test('intake: a vendor not yet known becomes a PROPOSAL, never an active vendor', async () => {
  const lines = invoiceLines.map((l) => l.replace('INV-7788', 'NEW-1').replace(VENDOR_GSTIN, gstin('24CCCCC2222C1Z')).replace('Kaveri Packaging Works', 'Gujarat Pallets LLP'));
  const up = await post(w.accounts.token, '/intake/upload', form(makeTextPdf(lines), 'gp.pdf')); const d = ok(await acc().get(`/intake/${up.body.id}`)); assert.equal(d.matched_vendor_id, null);
  const r = ok(await acc().post(`/intake/${up.body.id}/create-invoice`, { new_vendor: { name: 'Gujarat Pallets LLP', gstin: gstin('24CCCCC2222C1Z'), bank: { account_name: 'Gujarat Pallets', account_number: '4444555566', ifsc: 'HDFC0000099' } },
    number: 'NEW-1', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45430000 }), 201);
  const v = ok(await w.c(w.head1.token).get(`/vendors/${r.invoice.vendor_id}`)); assert.equal(v.status, 'pending_approval');
  assert.equal((await acc().post(`/invoices/${r.invoice.id}/submit`)).body.code, 'VENDOR_NOT_ACTIVE');
});
test('intake: scans without a text layer and images are routed to manual entry honestly (no fake OCR)', async () => {
  const blank = makeTextPdf(['x']); const up = await post(w.accounts.token, '/intake/upload', form(blank, 'scan.pdf')); const d = ok(await acc().get(`/intake/${up.body.id}`));
  assert.equal(d.status, 'needs_manual_entry'); assert.match(d.error, /no readable text layer/i);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
  const img = await post(w.accounts.token, '/intake/upload', form(png, 'photo.png')); const di = ok(await acc().get(`/intake/${img.body.id}`));
  assert.equal(di.status, 'needs_manual_entry'); assert.match(di.error, /OCR is not enabled/i);
});
test('audit: every action is chained and verifiable, the model refuses edits, and tampering is detected', async () => {
  const v1 = ok(await w.c(w.auditor.token).get('/audit/verify')); assert.equal(v1.ok, true); assert.ok(v1.checked > 30);
  const list = ok(await w.c(w.auditor.token).get('/audit?limit=5')); assert.ok(list.data[0].seq > list.data[4].seq); assert.ok(list.data[0].hash.length === 64);
  assert.equal((await w.c(w.requester.token).get('/audit')).status, 403);
  assert.equal((await w.c(w.auditor.token).get('/audit?format=csv')).status, 200);
  assert.equal((await w.c(w.head1.token).get('/audit?format=csv')).status, 403);        // finance head can view but not export
  await assert.rejects(AuditLog.updateOne({ organisation_id: w.orgId, seq: 1 }, { $set: { action: 'x' } }), /append-only/);
  await assert.rejects(AuditLog.deleteMany({ organisation_id: w.orgId }), /append-only/);
  await mongoose.connection.collection('auditlogs').updateOne({ seq: 5, organisation_id: new mongoose.Types.ObjectId(w.orgId) }, { $set: { action: 'tampered.action' } });
  const v2 = ok(await w.c(w.auditor.token).get('/audit/verify')); assert.equal(v2.ok, false); assert.equal(v2.broken_at, 5);
});
test('tenancy: organisations are isolated, and a query that forgets the organisation throws', async () => {
  const other = await createOrganisation({ name: 'Other Co', adminEmail: 'boss@other.test', adminName: 'Other Admin', adminPassword: PW });
  await assert.rejects(Invoice.find({}), /Tenant guard/);
  await assert.rejects(Invoice.findOne({ _id: new mongoose.Types.ObjectId() }), /Tenant guard/);
  await assert.rejects(Invoice.aggregate([{ $group: { _id: null } }]), /Tenant guard/);
  const l = await fetch(`${app.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'boss@other.test', password: PW }) });
  const tok = (await l.json() as any).access_token;
  const mine: any = await Invoice.findOne({ organisation_id: w.orgId, number: 'INV-7788' }).lean();
  assert.equal((await w.c(tok).get(`/invoices/${mine._id}`)).status, 403);   // other org's admin has no financial permission at all
  const roles = ok(await w.c(tok).get('/roles')) as any[]; assert.ok(roles.every((r) => r.id !== w.roles['Finance Head'])); // roles are per organisation
  assert.equal(String(other.org._id) === w.orgId, false);
  assert.equal((await w.c(tok).patch(`/users/${w.head1.id}`, { is_active: false })).status, 404);  // cannot touch another organisation's users
});
test('notifications and escalation: approvers are told, overdue approvals escalate once, and undelivered email is never faked', async () => {
  const inv = ok(await acc().post('/invoices', { number: 'ESC-1', vendor_id: vendor, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 1111100, total_minor: 1111100 }), 201);
  ok(await acc().post(`/invoices/${inv.id}/submit`));
  const steps: any[] = await ApprovalStep.find({ organisation_id: w.orgId, invoice_id: inv.id }).lean();
  const approverTok = [w.approver1, w.approver2, w.head1, w.head2].find((u) => u.id === String(steps[0].approver_id))!.token;
  const n = ok(await w.c(approverTok).get('/notifications')); assert.ok(n.unread >= 1); assert.ok(n.data.some((x: any) => x.kind === 'approval.requested' && x.email_state === 'undelivered'));
  await ApprovalStep.updateOne({ _id: steps[0]._id, organisation_id: w.orgId }, { $set: { activated_at: new Date(Date.now() - 48 * 3600000) } });
  const first = await escalateOverdueSteps(); assert.ok(first.escalated >= 1);
  const second = await escalateOverdueSteps(); assert.equal(second.escalated, 0);
  const heads = ok(await w.c(w.head1.token).get('/notifications')); assert.ok(heads.data.some((x: any) => x.kind === 'approval.overdue'));
  ok(await w.c(approverTok).post('/notifications/read', {}));
  assert.equal(ok(await w.c(approverTok).get('/notifications?unread=true')).unread, 0);
});
test('health: health and readiness endpoints answer without a session', async () => {
  const h = await fetch(`${app.base}/health`); assert.equal(h.status, 200);
  const r = await fetch(`${app.base}/ready`); const b = await r.json() as any; assert.equal(b.mongo, 'up'); assert.equal(b.email, 'not_configured');
  const evil = await fetch(`${app.base}/health`, { headers: { Origin: 'https://evil.example' } }); assert.equal(evil.status, 200); assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const good = await fetch(`${app.base}/health`, { headers: { Origin: 'http://localhost:5173' } }); assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const helmet = await fetch(`${app.base}/health`); assert.ok(helmet.headers.get('x-content-type-options')); assert.equal(helmet.headers.get('x-powered-by'), null);
});
