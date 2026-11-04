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
const boot_1 = require("../helpers/boot");
const world_1 = require("../helpers/world");
const models_1 = require("../../models");
let app;
let w;
let vendor;
(0, node_test_1.before)(async () => { app = await (0, boot_1.boot)(); w = await (0, world_1.makeWorld)(app.base); await (0, world_1.setupTaxAndRules)(w); vendor = await (0, world_1.makeVendor)(w); });
(0, node_test_1.after)(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);
(0, node_test_1.default)('vendors: proposed vendors start pending; bank numbers are encrypted and masked everywhere', async () => {
    const v = (0, world_1.ok)(await acc().post('/vendors', { name: 'Marina Logistics Pvt Ltd', gstin: (0, world_1.gstin)('29BBBBB1111B1Z'), bank: { account_name: 'Marina Logistics', account_number: '9876543210', ifsc: 'ICIC0004321' } }), 201);
    strict_1.default.equal(v.status, 'pending_approval');
    strict_1.default.equal(v.bank.account_masked, '••••3210');
    strict_1.default.ok(!JSON.stringify(v).includes('9876543210'));
    const raw = await models_1.Vendor.findOne({ _id: v.id, organisation_id: w.orgId }).lean();
    strict_1.default.ok(!JSON.stringify(raw).includes('9876543210'));
    strict_1.default.match(raw.bank.account_number_enc, /^v1:/);
    const list = (0, world_1.ok)(await w.c(w.approver1.token).get('/vendors'));
    strict_1.default.ok(!JSON.stringify(list).includes('987654321'));
    strict_1.default.equal((await w.c(w.requester.token).get('/vendors')).status, 403);
});
(0, node_test_1.default)('vendors: invalid tax and bank identifiers are rejected', async () => {
    strict_1.default.equal((await acc().post('/vendors', { name: 'Bad Gst Co', gstin: '33AAAAA0000A1ZZ' })).status, 400);
    strict_1.default.equal((await acc().post('/vendors', { name: 'Bad Pan Co', pan: 'NOTAPAN' })).status, 400);
    strict_1.default.equal((await acc().post('/vendors', { name: 'Bad Ifsc Co', bank: { account_name: 'x y', account_number: '123456789', ifsc: 'BAD' } })).status, 400);
});
(0, node_test_1.default)('vendors: only people with the permission can approve, and never their own proposal', async () => {
    const v = (0, world_1.ok)(await acc().post('/vendors', { name: 'Needs Approval Co', gstin: (0, world_1.gstin)('27AAPFU0939F1Z') }), 201);
    strict_1.default.equal((await acc().post(`/vendors/${v.id}/approve`, {})).status, 403);
    const role = (0, world_1.ok)(await w.c(w.admin.token).post('/roles', { name: 'Vendor Both', permissions: ['vendor.view', 'vendor.propose', 'vendor.approve'] }), 201);
    const both = await (0, world_1.addUser)(app.base, w.admin.token, role.id, 'both@kaveri.test', 'Both Hats');
    const mine = (0, world_1.ok)(await w.c(both.token).post('/vendors', { name: 'My Own Vendor' }), 201);
    const r = await w.c(both.token).post(`/vendors/${mine.id}/approve`, {});
    strict_1.default.equal(r.status, 403);
    strict_1.default.equal(r.body.code, 'SOD_VIOLATION');
    strict_1.default.equal(r.body.details.rule, 'proposer_cannot_approve');
    (0, world_1.ok)(await w.c(w.head1.token).post(`/vendors/${mine.id}/approve`, {}));
});
(0, node_test_1.default)('vendors: bank changes need a second person; reveal needs its own permission and is audited', async () => {
    const before = await models_1.Vendor.findOne({ _id: vendor, organisation_id: w.orgId }).lean();
    const ch = (0, world_1.ok)(await acc().post(`/vendors/${vendor}/bank-changes`, { reason: 'Vendor moved bank', bank: { account_name: 'Kaveri Packaging', account_number: '555500001111', ifsc: 'SBIN0001234' } }), 201);
    strict_1.default.equal((await acc().post(`/vendors/bank-changes/${ch.id}/approve`, {})).status, 403);
    const same = await models_1.Vendor.findOne({ _id: vendor, organisation_id: w.orgId }).lean();
    strict_1.default.equal(same.bank.account_last4, before.bank.account_last4); // not applied yet
    (0, world_1.ok)(await w.c(w.head1.token).post(`/vendors/bank-changes/${ch.id}/approve`, {}));
    strict_1.default.equal((0, world_1.ok)(await w.c(w.head1.token).get(`/vendors/${vendor}`)).bank.account_masked, '••••1111');
    strict_1.default.equal((await acc().post(`/vendors/${vendor}/reveal-bank`, {})).status, 403);
    strict_1.default.equal((0, world_1.ok)(await w.c(w.head1.token).post(`/vendors/${vendor}/reveal-bank`, {})).account_number, '555500001111');
    const audit = (0, world_1.ok)(await w.c(w.head1.token).get('/audit?action=vendor.bank_revealed'));
    strict_1.default.ok(audit.total >= 1);
    (0, world_1.ok)(await acc().post(`/vendors/${vendor}/bank-changes`, { reason: 'Switch back to original', bank: { account_name: 'Kaveri Packaging Works', account_number: '123456789012', ifsc: 'HDFC0001234' } }), 201);
    const pend = (0, world_1.ok)(await w.c(w.head1.token).get('/vendors/bank-changes'));
    (0, world_1.ok)(await w.c(w.head1.token).post(`/vendors/bank-changes/${pend[0].id}/approve`, {}));
});
(0, node_test_1.default)('invoices: money is integer paise, totals must add up, TDS comes from organisation settings', async () => {
    strict_1.default.equal((await acc().post('/invoices', { ...(0, world_1.invoiceBody)(vendor, 'BAD-1', 38500000), total_minor: 45000000 })).body.code, 'TOTAL_MISMATCH');
    strict_1.default.equal((await acc().post('/invoices', { ...(0, world_1.invoiceBody)(vendor, 'BAD-2', 38500000), subtotal_minor: 100.5 })).status, 400);
    strict_1.default.equal((await acc().post('/invoices', { ...(0, world_1.invoiceBody)(vendor, 'BAD-3', 38500000), line_items: [{ description: 'x', amount_minor: 1 }] })).body.code, 'LINES_MISMATCH');
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'INV-2291', 38500000, { line_items: [{ description: 'Cartons', amount_minor: 24000000 }, { description: 'Film', amount_minor: 14500000 }] })), 201);
    strict_1.default.equal(inv.status, 'draft');
    strict_1.default.equal(inv.total_minor, 45430000);
    strict_1.default.equal(inv.tds_minor, 385000);
    strict_1.default.equal(inv.net_payable_minor, 45045000);
    strict_1.default.equal(inv.tds_section, 'TEST1');
    strict_1.default.ok(Number.isInteger(inv.total_minor));
});
(0, node_test_1.default)('invoices: duplicates are blocked or need a recorded reason', async () => {
    strict_1.default.equal((await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'inv 2291', 38500000))).body.code, 'DUPLICATE_INVOICE_NUMBER'); // normalised: same number
    const sim = await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'INV-2292', 38500000));
    strict_1.default.equal(sim.status, 409);
    strict_1.default.equal(sim.body.code, 'POSSIBLE_DUPLICATE');
    const okInv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'INV-2292', 38500000, { duplicate_override_reason: 'Second consignment confirmed with vendor' })), 201);
    strict_1.default.equal(okInv.duplicate_override.reason, 'Second consignment confirmed with vendor');
});
(0, node_test_1.default)('approval: no generic status endpoint exists; unmatched invoices cannot be submitted', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'T-1', 1000000)), 201);
    strict_1.default.equal((await acc().post(`/invoices/${inv.id}/transition`, { status: 'approved' })).status, 404);
    const pendingVendor = (0, world_1.ok)(await acc().post('/vendors', { name: 'Not Yet Active' }), 201);
    const d2 = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(pendingVendor.id, 'PV-1', 1000000)), 201);
    strict_1.default.equal((await acc().post(`/invoices/${d2.id}/submit`)).body.code, 'VENDOR_NOT_ACTIVE');
});
(0, node_test_1.default)('approval: two-step sequential approval, limits and turn order are enforced', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'BIG-1', 100000000)), 201); // total ₹11,80,000
    const s = (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    strict_1.default.equal(s.status, 'in_review');
    strict_1.default.equal(s.rule_name, 'Large');
    const d = (0, world_1.ok)(await acc().get(`/invoices/${inv.id}`));
    const second = d.approval_steps[1].approver_id === w.head1.id ? w.head1 : w.head2;
    strict_1.default.equal(d.approval_steps[0].approver_name, 'Vikram Shah');
    strict_1.default.ok([w.head1.id, w.head2.id].includes(d.approval_steps[1].approver_id)); // every approver covers the full amount, ascending limit
    strict_1.default.ok([403, 404].includes((await w.c(w.approver1.token).post(`/invoices/${inv.id}/approve`, {})).status)); // Priya's ₹5,00,000 limit < ₹11,80,000: not assigned
    const early = await w.c(second.token).post(`/invoices/${inv.id}/approve`, {});
    strict_1.default.equal(early.status, 409);
    strict_1.default.equal(early.body.code, 'NOT_YOUR_TURN');
    (0, world_1.ok)(await w.c(w.approver2.token).post(`/invoices/${inv.id}/approve`, { comment: 'Looks right' }));
    strict_1.default.equal((0, world_1.ok)(await acc().get(`/invoices/${inv.id}`)).status, 'in_review');
    strict_1.default.equal((await w.c(w.approver2.token).post(`/invoices/${inv.id}/approve`, {})).status, 403); // cannot approve twice
    const done = (0, world_1.ok)(await w.c(second.token).post(`/invoices/${inv.id}/approve`, {}));
    strict_1.default.equal(done.status, 'approved');
    strict_1.default.equal((await w.c((second === w.head1 ? w.head2 : w.head1).token).post(`/invoices/${inv.id}/approve`, {})).status, 409); // already approved
});
(0, node_test_1.default)('approval: creators cannot approve their own invoices even with both permissions', async () => {
    const role = (0, world_1.ok)(await w.c(w.admin.token).post('/roles', { name: 'Maker Checker', permissions: ['invoice.create', 'invoice.edit_before_approval', 'invoice.approve', 'invoice.view_all'] }), 201);
    const mc = await (0, world_1.addUser)(app.base, w.admin.token, role.id, 'mc@kaveri.test', 'Maker Checker', { approval_unlimited: true });
    const inv = (0, world_1.ok)(await w.c(mc.token).post('/invoices', (0, world_1.invoiceBody)(vendor, 'MC-1', 1230000)), 201);
    const sub = (0, world_1.ok)(await w.c(mc.token).post(`/invoices/${inv.id}/submit`));
    const steps = (0, world_1.ok)(await w.c(mc.token).get(`/invoices/${inv.id}`)).approval_steps;
    strict_1.default.ok(!steps.some((x) => x.approver_id === mc.id)); // never assigned to the creator
    const r = await w.c(mc.token).post(`/invoices/${inv.id}/approve`, {});
    strict_1.default.equal(r.status, 403);
    strict_1.default.equal(r.body.code, 'SOD_VIOLATION');
    strict_1.default.equal(sub.status, 'in_review');
});
(0, node_test_1.default)('approval: reject needs a reason, hold raises a query, resume and reopen work, resubmission starts a new round', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'H-1', 2000000)), 201);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    const ap = w.c(w.approver1.token);
    strict_1.default.equal((await ap.post(`/invoices/${inv.id}/hold`, { reason: 'x' })).status, 400);
    const held = (0, world_1.ok)(await ap.post(`/invoices/${inv.id}/hold`, { reason: 'PO number missing on the invoice' }));
    strict_1.default.equal(held.status, 'on_hold');
    strict_1.default.equal((await ap.post(`/invoices/${inv.id}/approve`, {})).status, 409);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/resume`, { response: 'PO 4471 added' }));
    strict_1.default.equal((await ap.post(`/invoices/${inv.id}/reject`, { reason: 'no' })).status, 400);
    const rej = (0, world_1.ok)(await ap.post(`/invoices/${inv.id}/reject`, { reason: 'Rate does not match the contract' }));
    strict_1.default.equal(rej.status, 'rejected');
    strict_1.default.equal((await acc().put(`/invoices/${inv.id}`, { description: 'x' })).status, 409);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/reopen`));
    (0, world_1.ok)(await acc().put(`/invoices/${inv.id}`, { description: 'Corrected rate' }));
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    const d = (0, world_1.ok)(await acc().get(`/invoices/${inv.id}`));
    strict_1.default.equal(d.status, 'in_review');
    strict_1.default.ok(d.comments.some((c) => c.kind === 'query'));
    strict_1.default.ok(d.comments.some((c) => c.kind === 'response'));
    strict_1.default.equal(new Set(d.approval_steps.map((s) => s.round)).size, 2);
});
(0, node_test_1.default)('approval: editing an invoice on hold cancels its approvals and returns it to draft', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'H-2', 3000000)), 201);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    (0, world_1.ok)(await w.c(w.approver1.token).post(`/invoices/${inv.id}/hold`, { reason: 'Quantity looks wrong, please check' }));
    const e = (0, world_1.ok)(await acc().put(`/invoices/${inv.id}`, (0, world_1.invoiceBody)(vendor, 'H-2', 2500000)));
    strict_1.default.equal(e.status, 'draft');
    const steps = (0, world_1.ok)(await acc().get(`/invoices/${inv.id}`)).approval_steps;
    strict_1.default.ok(steps.every((s) => s.status === 'cancelled'));
});
(0, node_test_1.default)('approval: delegation lets a delegate act, and records who acted for whom', async () => {
    const inv = (0, world_1.ok)(await acc().post('/invoices', (0, world_1.invoiceBody)(vendor, 'D-1', 1500000)), 201);
    (0, world_1.ok)(await acc().post(`/invoices/${inv.id}/submit`));
    const first = (0, world_1.ok)(await acc().get(`/invoices/${inv.id}`)).approval_steps[0];
    const owner = first.approver_name === 'Priya Nair' ? w.approver1 : first.approver_name === 'Vikram Shah' ? w.approver2 : w.head1;
    const delegate = owner.id === w.head2.id ? w.head1 : w.head2;
    strict_1.default.equal((await w.c(delegate.token).post(`/invoices/${inv.id}/approve`, {})).status, 403);
    const now = Date.now();
    (0, world_1.ok)(await w.c(owner.token).post('/delegations', { to_user: delegate.id, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 86400000).toISOString() }), 201);
    const q = (0, world_1.ok)(await w.c(delegate.token).get('/approvals/queue?bucket=waiting'));
    strict_1.default.ok(q.some((i) => i.id === inv.id));
    (0, world_1.ok)(await w.c(delegate.token).post(`/invoices/${inv.id}/approve`, {}));
    const d = (0, world_1.ok)(await acc().get(`/invoices/${inv.id}`));
    const st = d.approval_steps.find((s) => s.status === 'approved');
    strict_1.default.equal(st.acted_by_name, delegate === w.head2 ? 'Meera Rao' : 'Anil Kapoor');
});
(0, node_test_1.default)('visibility: requesters see only their own invoices; approvers only assigned ones', async () => {
    const mine = (0, world_1.ok)(await w.c(w.requester.token).post('/invoices', (0, world_1.invoiceBody)(vendor, 'REQ-1', 500000)), 201);
    const list = (0, world_1.ok)(await w.c(w.requester.token).get('/invoices'));
    strict_1.default.ok(list.data.every((i) => i.created_by === w.requester.id));
    strict_1.default.ok(list.data.some((i) => i.id === mine.id));
    const other = await models_1.Invoice.findOne({ organisation_id: w.orgId, number: 'INV-2291' }).lean();
    strict_1.default.equal((await w.c(w.requester.token).get(`/invoices/${other._id}`)).status, 404);
    const big = await models_1.Invoice.findOne({ organisation_id: w.orgId, number: 'BIG-1' }).lean();
    strict_1.default.equal((await w.c(w.approver1.token).get(`/invoices/${big._id}`)).status, 404); // Priya was never assigned to it
    const pg = (0, world_1.ok)(await acc().get('/invoices?limit=3&page=1'));
    strict_1.default.equal(pg.data.length, 3);
    strict_1.default.ok(pg.total > 3);
});
(0, node_test_1.default)('approval rules: validated, org-scoped and audited', async () => {
    strict_1.default.equal((await w.c(w.head1.token).post('/approval-rules', { name: 'Bad', min_minor: 100, max_minor: 50, approvers_required: 1, mode: 'parallel' })).status, 400);
    strict_1.default.equal((await acc().post('/approval-rules', { name: 'Nope', min_minor: 0, approvers_required: 1, mode: 'parallel' })).status, 403);
    const rules = (0, world_1.ok)(await w.c(w.head1.token).get('/approval-rules'));
    strict_1.default.ok(rules.length >= 2);
});
//# sourceMappingURL=finance_flow.test.js.map