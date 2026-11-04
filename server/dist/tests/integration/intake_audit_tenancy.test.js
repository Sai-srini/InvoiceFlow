"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importStar(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const mongoose_1 = __importDefault(require("mongoose"));
const boot_1 = require("../helpers/boot");
const world_1 = require("../helpers/world");
const models_1 = require("../../models");
const approval_service_1 = require("../../services/approval.service");
const org_service_1 = require("../../services/org.service");
let app;
let w;
let vendor;
(0, node_test_1.before)(async () => { app = await (0, boot_1.boot)(); w = await (0, world_1.makeWorld)(app.base); await (0, world_1.setupTaxAndRules)(w); vendor = await (0, world_1.makeVendor)(w); });
(0, node_test_1.after)(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);
const BUYER = (0, world_1.gstin)('29BBBBB1111B1Z');
const invoiceLines = [`Kaveri Packaging Works`, `TAX INVOICE`, `GSTIN: ${world_1.VENDOR_GSTIN}`, `Invoice No: INV-7788`, `Invoice Date: 09/10/2026`, `Due Date: 24-Oct-2026`, `Bill To: Kaveri Foods Pvt Ltd`, `GSTIN: ${BUYER}`,
    `Corrugated carton 8,000 2,40,000.00`, `Taxable Value 3,85,000.00`, `CGST @9% 34,650.00`, `SGST @9% 34,650.00`, `Grand Total Rs. 4,54,300.00`];
const form = (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); return fd; };
const post = (token, path, fd) => fetch(app.base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
(0, node_test_1.default)('intake: files are checked by their real content, not their name', async () => {
    const fake = await post(w.accounts.token, '/intake/upload', form(Buffer.from('this is plain text, not a pdf'), 'invoice.pdf'));
    strict_1.default.equal(fake.status, 400);
    strict_1.default.equal(fake.body.code, 'INVALID_FILE');
    strict_1.default.equal((await post(w.accounts.token, '/intake/upload', form(Buffer.from('MZ\x90\x00 executable'), 'x.png'))).status, 400);
    strict_1.default.equal((await post(w.requester.token, '/intake/upload', form((0, boot_1.makeTextPdf)(invoiceLines), 'a.pdf'))).status, 403);
});
let intakeId;
(0, node_test_1.default)('intake: a real PDF is read, fields are extracted and validated, the vendor is matched by GSTIN', async () => {
    const up = await post(w.accounts.token, '/intake/upload', form((0, boot_1.makeTextPdf)(invoiceLines), 'kaveri-7788.pdf'));
    strict_1.default.equal(up.status, 201);
    intakeId = up.body.id;
    const d = (0, world_1.ok)(await acc().get(`/intake/${intakeId}`));
    strict_1.default.equal(d.status, 'extracted');
    strict_1.default.equal(d.text_source, 'pdf_text');
    const f = d.extraction.fields;
    strict_1.default.equal(f.invoice_number.value, 'INV-7788');
    strict_1.default.equal(f.invoice_date.value, '2026-10-09');
    strict_1.default.equal(f.due_date.value, '2026-10-24');
    strict_1.default.equal(f.vendor_gstin.value, world_1.VENDOR_GSTIN);
    strict_1.default.equal(f.buyer_gstin.value, BUYER);
    strict_1.default.deepEqual([f.subtotal_minor.value, f.cgst_minor.value, f.sgst_minor.value, f.total_minor.value], [38500000, 3465000, 3465000, 45430000]);
    strict_1.default.equal(d.extraction.checks.find((c) => c.key === 'totals').status, 'pass');
    strict_1.default.equal(d.matched_vendor_id, vendor);
    const dup = await post(w.accounts.token, '/intake/upload', form((0, boot_1.makeTextPdf)(invoiceLines), 'kaveri-7788-copy.pdf'));
    strict_1.default.equal(dup.status, 409);
    strict_1.default.equal(dup.body.code, 'DUPLICATE_FILE');
});
(0, node_test_1.default)('intake: nothing is auto-submitted; the reviewer converts it to a DRAFT, and the document is stored privately', async () => {
    const bad = await acc().post(`/intake/${intakeId}/create-invoice`, { vendor_id: vendor, number: 'INV-7788', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45000000 });
    strict_1.default.equal(bad.body.code, 'TOTAL_MISMATCH');
    const r = (0, world_1.ok)(await acc().post(`/intake/${intakeId}/create-invoice`, { vendor_id: vendor, number: 'INV-7788', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45430000, department: 'Packaging' }), 201);
    strict_1.default.equal(r.submitted, false);
    strict_1.default.equal(r.invoice.status, 'draft');
    strict_1.default.equal(r.invoice.has_file, true);
    strict_1.default.equal((0, world_1.ok)(await acc().get(`/intake/${intakeId}`)).status, 'converted');
    const noAuth = await fetch(`${app.base}/invoices/${r.invoice.id}/file`);
    strict_1.default.equal(noAuth.status, 401);
    const withAuth = await fetch(`${app.base}/invoices/${r.invoice.id}/file`, { headers: { Authorization: `Bearer ${w.accounts.token}` } });
    strict_1.default.equal(withAuth.status, 200);
    strict_1.default.equal(withAuth.headers.get('content-type'), 'application/pdf');
    strict_1.default.equal(withAuth.headers.get('x-content-type-options'), 'nosniff');
    strict_1.default.equal((await fetch(`${app.base}/invoices/${r.invoice.id}/file`, { headers: { Authorization: `Bearer ${w.requester.token}` } })).status, 404); // cannot see others' invoices
    strict_1.default.equal((await post(w.accounts.token, '/intake/upload', form((0, boot_1.makeTextPdf)(invoiceLines), 'again.pdf'))).status, 409); // file now belongs to an invoice
});
(0, node_test_1.default)('intake: a vendor not yet known becomes a PROPOSAL, never an active vendor', async () => {
    const lines = invoiceLines.map((l) => l.replace('INV-7788', 'NEW-1').replace(world_1.VENDOR_GSTIN, (0, world_1.gstin)('24CCCCC2222C1Z')).replace('Kaveri Packaging Works', 'Gujarat Pallets LLP'));
    const up = await post(w.accounts.token, '/intake/upload', form((0, boot_1.makeTextPdf)(lines), 'gp.pdf'));
    const d = (0, world_1.ok)(await acc().get(`/intake/${up.body.id}`));
    strict_1.default.equal(d.matched_vendor_id, null);
    const r = (0, world_1.ok)(await acc().post(`/intake/${up.body.id}/create-invoice`, { new_vendor: { name: 'Gujarat Pallets LLP', gstin: (0, world_1.gstin)('24CCCCC2222C1Z'), bank: { account_name: 'Gujarat Pallets', account_number: '4444555566', ifsc: 'HDFC0000099' } },
        number: 'NEW-1', invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 38500000, cgst_minor: 3465000, sgst_minor: 3465000, total_minor: 45430000 }), 201);
    const v = (0, world_1.ok)(await w.c(w.head1.token).get(`/vendors/${r.invoice.vendor_id}`));
    strict_1.default.equal(v.status, 'pending_approval');
    strict_1.default.equal((await acc().post(`/invoices/${r.invoice.id}/submit`)).body.code, 'VENDOR_NOT_ACTIVE');
});
(0, node_test_1.default)('intake: scans without a text layer and images are routed to manual entry honestly (no fake OCR)', async () => {
    const blank = (0, boot_1.makeTextPdf)(['x']);
    const up = await post(w.accounts.token, '/intake/upload', form(blank, 'scan.pdf'));
    const d = (0, world_1.ok)(await acc().get(`/intake/${up.body.id}`));
    strict_1.default.equal(d.status, 'needs_manual_entry');
    strict_1.default.match(d.error, /no readable text layer/i);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
    const img = await post(w.accounts.token, '/intake/upload', form(png, 'photo.png'));
    const di = (0, world_1.ok)(await acc().get(`/intake/${img.body.id}`));
    strict_1.default.equal(di.status, 'needs_manual_entry');
    strict_1.default.match(di.error, /OCR is not enabled/i);
});
(0, node_test_1.default)('audit: every action is chained and verifiable, the model refuses edits, and tampering is detected', async () => {
    const v1 = (0, world_1.ok)(await w.c(w.auditor.token).get('/audit/verify'));
    strict_1.default.equal(v1.ok, true);
    strict_1.default.ok(v1.checked > 30);
    const list = (0, world_1.ok)(await w.c(w.auditor.token).get('/audit?limit=5'));
    strict_1.default.ok(list.data[0].seq > list.data[4].seq);
    strict_1.default.ok(list.data[0].hash.length === 64);
    strict_1.default.equal((await w.c(w.requester.token).get('/audit')).status, 403);
    strict_1.default.equal((await w.c(w.auditor.token).get('/audit?format=csv')).status, 200);
    strict_1.default.equal((await w.c(w.head1.token).get('/audit?format=csv')).status, 403); // finance head can view but not export
    await strict_1.default.rejects(models_1.AuditLog.updateOne({ organisation_id: w.orgId, seq: 1 }, { $set: { action: 'x' } }), /append-only/);
    await strict_1.default.rejects(models_1.AuditLog.deleteMany({ organisation_id: w.orgId }), /append-only/);
    await mongoose_1.default.connection.collection('auditlogs').updateOne({ seq: 5, organisation_id: new mongoose_1.default.Types.ObjectId(w.orgId) }, { $set: { action: 'tampered.action' } });
    const v2 = (0, world_1.ok)(await w.c(w.auditor.token).get('/audit/verify'));
    strict_1.default.equal(v2.ok, false);
    strict_1.default.equal(v2.broken_at, 5);
});
(0, node_test_1.default)('tenancy: organisations are isolated, and a query that forgets the organisation throws', async () => {
    const other = await (0, org_service_1.createOrganisation)({ name: 'Other Co', adminEmail: 'boss@other.test', adminName: 'Other Admin', adminPassword: world_1.PW });
    await strict_1.default.rejects(models_1.Invoice.find({}), /Tenant guard/);
    await strict_1.default.rejects(models_1.Invoice.findOne({ _id: new mongoose_1.default.Types.ObjectId() }), /Tenant guard/);
    await strict_1.default.rejects(models_1.Invoice.aggregate([{ $group: { _id: null } }]), /Tenant guard/);
    const l = await fetch(`${app.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'boss@other.test', password: world_1.PW }) });
    const tok = (await l.json()).access_token;
    const mine = await models_1.Invoice.findOne({ organisation_id: w.orgId, number: 'INV-7788' }).lean();
    strict_1.default.equal((await w.c(tok).get(`/invoices/${mine._id}`)).status, 403); // other org's admin has no financial permission at all
    const roles = (0, world_1.ok)(await w.c(tok).get('/roles'));
    strict_1.default.ok(roles.every((r) => r.id !== w.roles['Finance Head'])); // roles are per organisation
    strict_1.default.equal(String(other.org._id) === w.orgId, false);
    strict_1.default.equal((await w.c(tok).patch(`/users/${w.head1.id}`, { is_active: false })).status, 404); // cannot touch another organisation's users
});
(0, node_test_1.default)('notifications and escalation: approvers are told, overdue approvals escalate once, and undelivered email is never faked', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', { number: 'ESC-1', vendor_id: vendor, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 1111100, total_minor: 1111100 }), 201);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    const steps = await models_1.ApprovalStep.find({ organisation_id: w.orgId, invoice_id: inv.id }).lean();
    const approverTok = [w.approver1, w.approver2, w.head1, w.head2].find((u) => u.id === String(steps[0].approver_id)).token;
    const n = (0, world_1.ok)(await w.c(approverTok).get('/notifications'));
    strict_1.default.ok(n.unread >= 1);
    strict_1.default.ok(n.data.some((x) => x.kind === 'approval.requested' && x.email_state === 'undelivered'));
    await models_1.ApprovalStep.updateOne({ _id: steps[0]._id, organisation_id: w.orgId }, { $set: { activated_at: new Date(Date.now() - 48 * 3600000) } });
    const first = await (0, approval_service_1.escalateOverdueSteps)();
    strict_1.default.ok(first.escalated >= 1);
    const second = await (0, approval_service_1.escalateOverdueSteps)();
    strict_1.default.equal(second.escalated, 0);
    const heads = (0, world_1.ok)(await w.c(w.head1.token).get('/notifications'));
    strict_1.default.ok(heads.data.some((x) => x.kind === 'approval.overdue'));
    (0, world_1.ok)(await w.c(approverTok).post('/notifications/read', {}));
    strict_1.default.equal((0, world_1.ok)(await w.c(approverTok).get('/notifications?unread=true')).unread, 0);
});
(0, node_test_1.default)('health: health and readiness endpoints answer without a session', async () => {
    const h = await fetch(`${app.base}/health`);
    strict_1.default.equal(h.status, 200);
    const r = await fetch(`${app.base}/ready`);
    const b = await r.json();
    strict_1.default.equal(b.mongo, 'up');
    strict_1.default.equal(b.email, 'not_configured');
    const evil = await fetch(`${app.base}/health`, { headers: { Origin: 'https://evil.example' } });
    strict_1.default.equal(evil.status, 200);
    strict_1.default.equal(evil.headers.get('access-control-allow-origin'), null);
    const good = await fetch(`${app.base}/health`, { headers: { Origin: 'http://localhost:5173' } });
    strict_1.default.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const helmet = await fetch(`${app.base}/health`);
    strict_1.default.ok(helmet.headers.get('x-content-type-options'));
    strict_1.default.equal(helmet.headers.get('x-powered-by'), null);
});
//# sourceMappingURL=intake_audit_tenancy.test.js.map