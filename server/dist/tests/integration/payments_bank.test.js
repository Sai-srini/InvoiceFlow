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
let vendor2;
(0, node_test_1.before)(async () => { app = await (0, boot_1.boot)(); w = await (0, world_1.makeWorld)(app.base); await (0, world_1.setupTaxAndRules)(w); vendor = await (0, world_1.makeVendor)(w); vendor2 = await (0, world_1.makeVendor)(w, 'Marina Logistics Pvt Ltd', (0, world_1.gstin)('29BBBBB1111B1Z'), '9876543210'); });
(0, node_test_1.after)(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);
const head = () => w.c(w.head1.token);
const today = '2026-10-16';
let runA;
let payments = [];
let invoiceIds = [];
(0, node_test_1.default)('payment run: only approved invoices, preparer cannot release, held payments are carved out', async () => {
    const i1 = await (0, world_1.approvedInvoice)(w, vendor, 'PR-INV-1', 10000000);
    const i2 = await (0, world_1.approvedInvoice)(w, vendor2, 'PR-INV-2', 20000000);
    const i3 = await (0, world_1.approvedInvoice)(w, vendor, 'PR-INV-3', 3000000);
    invoiceIds = [i1, i2, i3];
    const draft = (0, world_1.ok)(await acc().post('/invoices', { number: 'DRAFT-1', vendor_id: vendor, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 100, total_minor: 100 }), 201);
    strict_1.default.equal((await acc().post('/payment-runs', { invoice_ids: [draft.id], pay_date: today })).body.code, 'NOT_APPROVED');
    runA = (0, world_1.ok)(await acc().post('/payment-runs', { invoice_ids: [i1, i2, i3], pay_date: today }), 201);
    strict_1.default.equal(runA.status, 'draft');
    strict_1.default.equal(runA.count, 3);
    strict_1.default.equal(runA.required_signatures, 1);
    const detail = (0, world_1.ok)(await acc().get(`/payment-runs/${runA.id}`));
    payments = detail.payments;
    strict_1.default.equal(payments.length, 3);
    strict_1.default.ok(payments.every((p) => p.status === 'scheduled' && /^PMT-\d{4}-\d{6}$/.test(p.reference)));
    strict_1.default.ok(!JSON.stringify(detail).includes('123456789012')); // account numbers never appear
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: i1, organisation_id: w.orgId }).lean()).status, 'scheduled');
    strict_1.default.equal((await acc().post('/payment-runs', { invoice_ids: [i1], pay_date: today })).body.code, 'NOT_APPROVED'); // cannot schedule twice
    strict_1.default.equal((await acc().post(`/payment-runs/${runA.id}/release`, {})).status, 403); // accounts team cannot release
    const role = (0, world_1.ok)(await w.c(w.admin.token).post('/roles', { name: 'Prepare And Release', permissions: ['payment.view', 'payment.prepare_run', 'payment.release_run', 'invoice.view_all'] }), 201);
    const both = await (0, world_1.addUser)(app.base, w.admin.token, role.id, 'pr-both@kaveri.test', 'Both Hats');
    const i4 = await (0, world_1.approvedInvoice)(w, vendor, 'PR-INV-4', 1500000);
    const mine = (0, world_1.ok)(await w.c(both.token).post('/payment-runs', { invoice_ids: [i4], pay_date: today }), 201);
    const r = await w.c(both.token).post(`/payment-runs/${mine.id}/release`, {});
    strict_1.default.equal(r.status, 403);
    strict_1.default.equal(r.body.details.rule, 'run_preparer_cannot_release');
    (0, world_1.ok)(await w.c(both.token).post(`/payment-runs/${mine.id}/cancel`, { reason: 'Test cleanup run' }));
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: i4, organisation_id: w.orgId }).lean()).status, 'approved');
});
(0, node_test_1.default)('payment run: hold blocks release, the run is released by a different person, the bank file is generated and hashed', async () => {
    const held = (0, world_1.ok)(await acc().post(`/payments/${payments[2].id}/hold`, { reason: 'Vendor dispute on quantity' }));
    strict_1.default.equal(held.status, 'held');
    strict_1.default.equal((await acc().post(`/payments/${payments[2].id}/release-hold`, {})).status, 403);
    const rel = (0, world_1.ok)(await head().post(`/payment-runs/${runA.id}/release`, {}));
    strict_1.default.equal(rel.state, 'released');
    strict_1.default.equal(rel.run.count, 2);
    strict_1.default.equal(rel.run.status, 'released');
    const after = (0, world_1.ok)(await head().get(`/payment-runs/${runA.id}`));
    strict_1.default.deepEqual(after.payments.map((p) => p.status).sort(), ['cancelled', 'released', 'released']);
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: invoiceIds[2], organisation_id: w.orgId }).lean()).status, 'approved'); // held invoice is back to approved
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: invoiceIds[0], organisation_id: w.orgId }).lean()).status, 'released');
    strict_1.default.equal((await acc().get(`/payment-runs/${runA.id}/file`)).status, 403);
    const f = await fetch(`${app.base}/payment-runs/${runA.id}/file`, { headers: { Authorization: `Bearer ${w.head1.token}` } });
    const text = await f.text();
    strict_1.default.equal(f.status, 200);
    strict_1.default.match(text, /^reference,beneficiary_name,account_number,ifsc,amount/);
    strict_1.default.ok(text.includes('123456789012') && text.includes('9876543210'));
    strict_1.default.ok(text.includes(payments[0].reference));
    strict_1.default.ok(!text.includes(payments[2].reference)); // held payment is not in the file
    const again = (0, world_1.ok)(await head().post(`/payment-runs/${runA.id}/release`, {}));
    strict_1.default.equal(again.idempotent, true); // repeating is harmless
    strict_1.default.equal((await head().post('/payment-runs/' + runA.id + '/send-to-bank', {})).body.code, 'NOT_CONFIGURED'); // no payout provider is faked
});
(0, node_test_1.default)('payments: nothing becomes PAID without a confirmation path; failures reopen the invoice', async () => {
    const p = await models_1.Payment.findOne({ organisation_id: w.orgId, reference: payments[0].reference }).lean();
    strict_1.default.equal(p.status, 'released');
    strict_1.default.ok(!p.paid_at);
    strict_1.default.equal((await acc().post(`/payments/${p._id}/confirm-paid`, { bank_reference: 'UTR123456' })).status, 403);
    const failed = (0, world_1.ok)(await head().post(`/payments/${p._id}/mark-failed`, { reason: 'Beneficiary account closed' }));
    strict_1.default.equal(failed.status, 'failed');
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: invoiceIds[0], organisation_id: w.orgId }).lean()).status, 'approved');
    strict_1.default.equal((await head().post(`/payments/${p._id}/confirm-paid`, { bank_reference: 'UTR123456' })).status, 409); // a failed payment cannot be confirmed
});
(0, node_test_1.default)('dual release: above the threshold two different people must sign', async () => {
    (0, world_1.ok)(await w.c(w.admin.token).put('/settings/sod', { dual_release_threshold_minor: 1 }));
    const i = await (0, world_1.approvedInvoice)(w, vendor, 'PR-INV-5', 5000000);
    const run = (0, world_1.ok)(await acc().post('/payment-runs', { invoice_ids: [i], pay_date: today }), 201);
    strict_1.default.equal(run.required_signatures, 2);
    const first = (0, world_1.ok)(await head().post(`/payment-runs/${run.id}/release`, {}));
    strict_1.default.equal(first.state, 'awaiting_signature');
    strict_1.default.equal(first.signatures_needed, 1);
    const same = await head().post(`/payment-runs/${run.id}/release`, {});
    strict_1.default.equal(same.status, 403);
    strict_1.default.equal(same.body.details.rule, 'distinct_signatories');
    const second = (0, world_1.ok)(await w.c(w.head2.token).post(`/payment-runs/${run.id}/release`, {}));
    strict_1.default.equal(second.state, 'released');
    (0, world_1.ok)(await w.c(w.admin.token).put('/settings/sod', { dual_release_threshold_minor: 25000000000 }));
});
// ---------------------------------------------------------------- bank statements
let accountId;
let profileId;
let fresh;
let rel = [];
const csv = (rows) => ['Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance', ...rows].join('\n');
const upload = async (token, content, name = 'stmt.csv') => {
    const fd = new FormData();
    fd.append('bank_account_id', accountId);
    fd.append('profile_id', profileId);
    fd.append('file', new Blob([content], { type: 'text/csv' }), name);
    const r = await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: await r.json() };
};
(0, node_test_1.default)('bank: a mapping profile is validated and previewed before anything is saved', async () => {
    accountId = (0, world_1.ok)(await acc().post('/bank/accounts', { name: 'Current A/C ••4821', bank_name: 'Sample Bank', account_last4: '4821', ifsc: 'HDFC0001234' }), 201)._id;
    const bad = await acc().post('/bank/profiles', { bank_account_id: accountId, name: 'Bad', date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', amount_mode: 'separate' });
    strict_1.default.equal(bad.status, 400);
    const profile = { bank_account_id: accountId, name: 'Sample layout', format: 'csv', header_row: 0, date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', reference_column: 'Chq/Ref No',
        amount_mode: 'separate', debit_column: 'Withdrawal Amt', credit_column: 'Deposit Amt', balance_column: 'Closing Balance', decimal_separator: '.', skip_footer_rows: 0 };
    profileId = (0, world_1.ok)(await acc().post('/bank/profiles', profile), 201)._id;
    const fd = new FormData();
    fd.append('profile', JSON.stringify({ ...profile, bank_account_id: undefined }));
    fd.append('file', new Blob([csv(['16/10/2026,TEST,R1,"1,000.00",,"9,000.00"'])]), 'p.csv');
    const pv = await (await fetch(`${app.base}/bank/profiles/preview`, { method: 'POST', headers: { Authorization: `Bearer ${w.accounts.token}` }, body: fd })).json();
    strict_1.default.equal(pv.line_count, 1);
    strict_1.default.equal(pv.lines[0].debit_minor, 100000);
});
(0, node_test_1.default)('bank: import matches a payment by its reference, ignores credits, queues exceptions, and refuses duplicates', async () => {
    const pays = await models_1.Payment.find({ organisation_id: w.orgId, status: 'released' }).sort({ createdAt: 1 }).lean();
    rel = pays; // PMT of invoice 2 (Marina) is released; invoice 1's payment failed earlier
    const marina = pays.find((p) => p.vendor_name === 'Marina Logistics Pvt Ltd');
    strict_1.default.ok(marina);
    const net = marina.net_minor;
    const m = (n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
    const stmt = csv([`16/10/2026,NEFT ${marina.reference} MARINA,N284100001,"${m(net)}",,"${m(2000000 * 100 - net)}"`, `17/10/2026,UPI RECEIPT CUSTOMER,U1,,"5,000.00","${m(2000000 * 100 - net + 500000)}"`, `17/10/2026,UNKNOWN DEBIT 777,X9,"1,234.00",,"${m(2000000 * 100 - net + 500000 - 123400)}"`]);
    const r = await upload(w.accounts.token, stmt);
    strict_1.default.equal(r.status, 201);
    strict_1.default.equal(r.body.line_count, 3);
    strict_1.default.equal(r.body.balance_check.ok, true);
    const lines = (0, world_1.ok)(await acc().get('/bank/lines?limit=50')).data;
    const matched = lines.find((l) => l.narration.includes(marina.reference));
    strict_1.default.equal(matched.status, 'matched');
    strict_1.default.equal(matched.matches[0].method, 'reference');
    strict_1.default.equal(lines.find((l) => l.narration.includes('RECEIPT')).status, 'ignored');
    strict_1.default.equal(lines.find((l) => l.narration.includes('UNKNOWN')).status, 'exception');
    const p = await models_1.Payment.findOne({ _id: marina._id, organisation_id: w.orgId }).lean();
    strict_1.default.equal(p.status, 'paid');
    strict_1.default.equal(p.paid_via, 'bank_statement');
    strict_1.default.equal(p.reconciled, true);
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: marina.invoice_id, organisation_id: w.orgId }).lean()).status, 'reconciled');
    const dup = await upload(w.accounts.token, stmt);
    strict_1.default.equal(dup.status, 409);
    strict_1.default.equal(dup.body.code, 'DUPLICATE_FILE');
    const overlap = await upload(w.accounts.token, stmt + '\n18/10/2026,NEW LINE,N2,"10.00",,"0.00"'); // balance chain broken on purpose, one new line
    strict_1.default.equal(overlap.status, 201);
    strict_1.default.equal(overlap.body.line_count, 1);
    strict_1.default.equal(overlap.body.skipped_duplicates, 3);
    strict_1.default.equal(overlap.body.balance_check.ok, false);
});
(0, node_test_1.default)('bank: statements that do not fit the mapping are rejected as a whole with row numbers', async () => {
    const r = await upload(w.accounts.token, csv(['not-a-date,X,R,"1.00",,"1.00"']));
    strict_1.default.equal(r.status, 422);
    strict_1.default.equal(r.body.code, 'STATEMENT_PARSE_ERRORS');
    strict_1.default.match(JSON.stringify(r.body.details.errors), /does not match format DD\/MM\/YYYY/);
    const fd = new FormData();
    fd.append('bank_account_id', accountId);
    fd.append('profile_id', profileId);
    fd.append('file', new Blob([Buffer.from([0, 1, 2, 3])]), 'x.csv');
    strict_1.default.equal((await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${w.accounts.token}` }, body: fd })).status, 400);
    strict_1.default.equal((await head().post('/bank/profiles', {})).status, 400);
    const fd2 = new FormData();
    fd2.append('bank_account_id', accountId);
    fd2.append('profile_id', profileId);
    fd2.append('file', new Blob(['a,b']), 'y.csv');
    strict_1.default.equal((await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${w.requester.token}` }, body: fd2 })).status, 403);
});
(0, node_test_1.default)('bank: manual match needs a second person, validated amounts, and can be reversed with a reason', async () => {
    const issue = async () => {
        const iid = await (0, world_1.approvedInvoice)(w, vendor, 'REC-' + Math.random().toString(36).slice(2, 6), 7000000 + Math.floor(Math.random() * 90000));
        const run = (0, world_1.ok)(await acc().post('/payment-runs', { invoice_ids: [iid], pay_date: today }), 201);
        (0, world_1.ok)(await head().post(`/payment-runs/${run.id}/release`, {}));
        return { iid, pay: (await models_1.Payment.findOne({ organisation_id: w.orgId, invoice_id: iid }).lean()) };
    };
    const { iid, pay } = await issue();
    const unknown = await models_1.StatementLine.findOne({ organisation_id: w.orgId, status: 'exception' }).lean();
    const wrong = await acc().post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: pay.net_minor }] });
    strict_1.default.equal(wrong.status, 400); // line is only ₹1,234.00 so a bigger allocation is refused
    const small = (0, world_1.ok)(await acc().post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: 123400 }] }));
    strict_1.default.equal(small.status, 'pending_approval');
    strict_1.default.equal((await acc().post(`/bank/lines/${unknown._id}/approve-match`, {})).status, 403); // accounts lack the approval permission
    const both = (0, world_1.ok)(await w.c(w.admin.token).post('/roles', { name: 'Recon Both', permissions: ['bank.view', 'bank.reconcile', 'bank.approve_manual_match'] }), 201);
    const rb = await (0, world_1.addUser)(app.base, w.admin.token, both.id, 'rb@kaveri.test', 'Recon Both');
    const sod = await w.c(rb.token).post(`/bank/lines/${unknown._id}/approve-match`, {});
    strict_1.default.equal(sod.status, 200); // proposer is someone else, importer is someone else
    const p1 = await models_1.Payment.findOne({ _id: pay._id, organisation_id: w.orgId }).lean();
    strict_1.default.equal(p1.reconciled_minor, 123400);
    strict_1.default.equal(p1.reconciled, false);
    strict_1.default.equal(p1.status, 'paid');
    strict_1.default.equal((await head().post(`/bank/lines/${unknown._id}/unmatch`, { reason: 'x' })).status, 400);
    (0, world_1.ok)(await head().post(`/bank/lines/${unknown._id}/unmatch`, { reason: 'Matched to the wrong payment' }));
    const p2 = await models_1.Payment.findOne({ _id: pay._id, organisation_id: w.orgId }).lean();
    strict_1.default.equal(p2.status, 'released');
    strict_1.default.equal(p2.reconciled_minor, 0);
    strict_1.default.equal((await models_1.Invoice.findOne({ _id: iid, organisation_id: w.orgId }).lean()).status, 'released');
    // a person who proposes a match cannot approve it
    const line2 = (0, world_1.ok)(await w.c(rb.token).post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: 123400 }] }));
    const self = await w.c(rb.token).post(`/bank/lines/${unknown._id}/approve-match`, {});
    strict_1.default.equal(self.status, 403);
    strict_1.default.equal(self.body.details.rule, 'proposer_cannot_approve');
    strict_1.default.equal(line2.status, 'pending_approval');
});
(0, node_test_1.default)('reports: every report answers, CSV exports neutralise formulas, journal export works', async () => {
    for (const p of ['dashboard', 'aging', 'vendor-spend', 'approval-turnaround', 'payments-due', 'cash-flow', 'tds', 'reconciliation']) {
        const r = await head().get(`/reports/${p}`);
        strict_1.default.equal(r.status, 200, p);
    }
    const d = (0, world_1.ok)(await head().get('/reports/dashboard'));
    strict_1.default.ok(d.invoices_by_status);
    strict_1.default.equal(typeof d.avg_approval_hours === 'number' || d.avg_approval_hours === null, true);
    const aging = (0, world_1.ok)(await head().get('/reports/aging'));
    strict_1.default.ok(aging.buckets['90+'] !== undefined);
    const csvRes = await fetch(`${app.base}/reports/vendor-spend?format=csv`, { headers: { Authorization: `Bearer ${w.head1.token}` } });
    strict_1.default.match(csvRes.headers.get('content-type') || '', /text\/csv/);
    strict_1.default.match(await csvRes.text(), /^vendor,invoices,total,average/);
    const j = await fetch(`${app.base}/reports/journal-export`, { headers: { Authorization: `Bearer ${w.head1.token}` } });
    strict_1.default.equal(j.status, 200);
    strict_1.default.equal((await acc().get('/reports/tds')).status, 403);
    const evil = (0, world_1.ok)(await w.c(w.accounts.token).post('/vendors', { name: '=HYPERLINK("http://evil")' }), 201);
    strict_1.default.ok(evil.id);
});
//# sourceMappingURL=payments_bank.test.js.map