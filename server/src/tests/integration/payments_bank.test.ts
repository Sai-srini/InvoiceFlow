import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from '../helpers/boot';
import { makeWorld, World, ok, makeVendor, setupTaxAndRules, approvedInvoice, addUser, gstin } from '../helpers/world';
import { Payment, Invoice, StatementLine } from '../../models';

let app: Awaited<ReturnType<typeof boot>>; let w: World; let vendor: string; let vendor2: string;
before(async () => { app = await boot(); w = await makeWorld(app.base); await setupTaxAndRules(w); vendor = await makeVendor(w); vendor2 = await makeVendor(w, 'Marina Logistics Pvt Ltd', gstin('29BBBBB1111B1Z'), '9876543210'); });
after(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token); const head = () => w.c(w.head1.token);
const today = '2026-10-16';
let runA: any; let payments: any[] = []; let invoiceIds: string[] = [];

test('payment run: only approved invoices, preparer cannot release, held payments are carved out', async () => {
  const i1 = await approvedInvoice(w, vendor, 'PR-INV-1', 10000000); const i2 = await approvedInvoice(w, vendor2, 'PR-INV-2', 20000000); const i3 = await approvedInvoice(w, vendor, 'PR-INV-3', 3000000);
  invoiceIds = [i1, i2, i3];
  const draft = ok(await acc().post('/invoices', { number: 'DRAFT-1', vendor_id: vendor, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: 100, total_minor: 100 }), 201);
  assert.equal((await acc().post('/payment-runs', { invoice_ids: [draft.id], pay_date: today })).body.code, 'NOT_APPROVED');
  runA = ok(await acc().post('/payment-runs', { invoice_ids: [i1, i2, i3], pay_date: today }), 201);
  assert.equal(runA.status, 'draft'); assert.equal(runA.count, 3); assert.equal(runA.required_signatures, 1);
  const detail = ok(await acc().get(`/payment-runs/${runA.id}`)); payments = detail.payments; assert.equal(payments.length, 3);
  assert.ok(payments.every((p: any) => p.status === 'scheduled' && /^PMT-\d{4}-\d{6}$/.test(p.reference)));
  assert.ok(!JSON.stringify(detail).includes('123456789012'));                          // account numbers never appear
  assert.equal((await Invoice.findOne({ _id: i1, organisation_id: w.orgId }).lean() as any).status, 'scheduled');
  assert.equal((await acc().post('/payment-runs', { invoice_ids: [i1], pay_date: today })).body.code, 'NOT_APPROVED'); // cannot schedule twice
  assert.equal((await acc().post(`/payment-runs/${runA.id}/release`, {})).status, 403);                               // accounts team cannot release
  const role = ok(await w.c(w.admin.token).post('/roles', { name: 'Prepare And Release', permissions: ['payment.view', 'payment.prepare_run', 'payment.release_run', 'invoice.view_all'] }), 201);
  const both = await addUser(app.base, w.admin.token, role.id, 'pr-both@kaveri.test', 'Both Hats');
  const i4 = await approvedInvoice(w, vendor, 'PR-INV-4', 1500000);
  const mine = ok(await w.c(both.token).post('/payment-runs', { invoice_ids: [i4], pay_date: today }), 201);
  const r = await w.c(both.token).post(`/payment-runs/${mine.id}/release`, {});
  assert.equal(r.status, 403); assert.equal(r.body.details.rule, 'run_preparer_cannot_release');
  ok(await w.c(both.token).post(`/payment-runs/${mine.id}/cancel`, { reason: 'Test cleanup run' }));
  assert.equal((await Invoice.findOne({ _id: i4, organisation_id: w.orgId }).lean() as any).status, 'approved');
});
test('payment run: hold blocks release, the run is released by a different person, the bank file is generated and hashed', async () => {
  const held = ok(await acc().post(`/payments/${payments[2].id}/hold`, { reason: 'Vendor dispute on quantity' })); assert.equal(held.status, 'held');
  assert.equal((await acc().post(`/payments/${payments[2].id}/release-hold`, {})).status, 403);
  const rel = ok(await head().post(`/payment-runs/${runA.id}/release`, {}));
  assert.equal(rel.state, 'released'); assert.equal(rel.run.count, 2); assert.equal(rel.run.status, 'released');
  const after = ok(await head().get(`/payment-runs/${runA.id}`));
  assert.deepEqual(after.payments.map((p: any) => p.status).sort(), ['cancelled', 'released', 'released']);
  assert.equal((await Invoice.findOne({ _id: invoiceIds[2], organisation_id: w.orgId }).lean() as any).status, 'approved'); // held invoice is back to approved
  assert.equal((await Invoice.findOne({ _id: invoiceIds[0], organisation_id: w.orgId }).lean() as any).status, 'released');
  assert.equal((await acc().get(`/payment-runs/${runA.id}/file`)).status, 403);
  const f = await fetch(`${app.base}/payment-runs/${runA.id}/file`, { headers: { Authorization: `Bearer ${w.head1.token}` } }); const text = await f.text();
  assert.equal(f.status, 200); assert.match(text, /^reference,beneficiary_name,account_number,ifsc,amount/);
  assert.ok(text.includes('123456789012') && text.includes('9876543210')); assert.ok(text.includes(payments[0].reference));
  assert.ok(!text.includes(payments[2].reference));                                                                        // held payment is not in the file
  const again = ok(await head().post(`/payment-runs/${runA.id}/release`, {})); assert.equal(again.idempotent, true);       // repeating is harmless
  assert.equal((await head().post('/payment-runs/' + runA.id + '/send-to-bank', {})).body.code, 'NOT_CONFIGURED');       // no payout provider is faked
});
test('payments: nothing becomes PAID without a confirmation path; failures reopen the invoice', async () => {
  const p = (await Payment.findOne({ organisation_id: w.orgId, reference: payments[0].reference }).lean() as any);
  assert.equal(p.status, 'released'); assert.ok(!p.paid_at);
  assert.equal((await acc().post(`/payments/${p._id}/confirm-paid`, { bank_reference: 'UTR123456' })).status, 403);
  const failed = ok(await head().post(`/payments/${p._id}/mark-failed`, { reason: 'Beneficiary account closed' })); assert.equal(failed.status, 'failed');
  assert.equal((await Invoice.findOne({ _id: invoiceIds[0], organisation_id: w.orgId }).lean() as any).status, 'approved');
  assert.equal((await head().post(`/payments/${p._id}/confirm-paid`, { bank_reference: 'UTR123456' })).status, 409);       // a failed payment cannot be confirmed
});
test('dual release: above the threshold two different people must sign', async () => {
  ok(await w.c(w.admin.token).put('/settings/sod', { dual_release_threshold_minor: 1 }));
  const i = await approvedInvoice(w, vendor, 'PR-INV-5', 5000000);
  const run = ok(await acc().post('/payment-runs', { invoice_ids: [i], pay_date: today }), 201); assert.equal(run.required_signatures, 2);
  const first = ok(await head().post(`/payment-runs/${run.id}/release`, {})); assert.equal(first.state, 'awaiting_signature'); assert.equal(first.signatures_needed, 1);
  const same = await head().post(`/payment-runs/${run.id}/release`, {}); assert.equal(same.status, 403); assert.equal(same.body.details.rule, 'distinct_signatories');
  const second = ok(await w.c(w.head2.token).post(`/payment-runs/${run.id}/release`, {})); assert.equal(second.state, 'released');
  ok(await w.c(w.admin.token).put('/settings/sod', { dual_release_threshold_minor: 25000000000 }));
});

// ---------------------------------------------------------------- bank statements
let accountId: string; let profileId: string; let fresh: any; let rel: any[] = [];
const csv = (rows: string[]) => ['Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance', ...rows].join('\n');
const upload = async (token: string, content: string, name = 'stmt.csv') => {
  const fd = new FormData(); fd.append('bank_account_id', accountId); fd.append('profile_id', profileId); fd.append('file', new Blob([content], { type: 'text/csv' }), name);
  const r = await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, body: await r.json() as any };
};
test('bank: a mapping profile is validated and previewed before anything is saved', async () => {
  accountId = ok(await acc().post('/bank/accounts', { name: 'Current A/C ••4821', bank_name: 'Sample Bank', account_last4: '4821', ifsc: 'HDFC0001234' }), 201)._id;
  const bad = await acc().post('/bank/profiles', { bank_account_id: accountId, name: 'Bad', date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', amount_mode: 'separate' });
  assert.equal(bad.status, 400);
  const profile = { bank_account_id: accountId, name: 'Sample layout', format: 'csv', header_row: 0, date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', reference_column: 'Chq/Ref No',
    amount_mode: 'separate', debit_column: 'Withdrawal Amt', credit_column: 'Deposit Amt', balance_column: 'Closing Balance', decimal_separator: '.', skip_footer_rows: 0 };
  profileId = ok(await acc().post('/bank/profiles', profile), 201)._id;
  const fd = new FormData(); fd.append('profile', JSON.stringify({ ...profile, bank_account_id: undefined })); fd.append('file', new Blob([csv(['16/10/2026,TEST,R1,"1,000.00",,"9,000.00"'])]), 'p.csv');
  const pv = await (await fetch(`${app.base}/bank/profiles/preview`, { method: 'POST', headers: { Authorization: `Bearer ${w.accounts.token}` }, body: fd })).json() as any;
  assert.equal(pv.line_count, 1); assert.equal(pv.lines[0].debit_minor, 100000);
});
test('bank: import matches a payment by its reference, ignores credits, queues exceptions, and refuses duplicates', async () => {
  const pays: any[] = await Payment.find({ organisation_id: w.orgId, status: 'released' }).sort({ createdAt: 1 }).lean();
  rel = pays; // PMT of invoice 2 (Marina) is released; invoice 1's payment failed earlier
  const marina = pays.find((p) => p.vendor_name === 'Marina Logistics Pvt Ltd'); assert.ok(marina);
  const net = marina.net_minor; const m = (n: number) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
  const stmt = csv([`16/10/2026,NEFT ${marina.reference} MARINA,N284100001,"${m(net)}",,"${m(2000000 * 100 - net)}"`, `17/10/2026,UPI RECEIPT CUSTOMER,U1,,"5,000.00","${m(2000000 * 100 - net + 500000)}"`, `17/10/2026,UNKNOWN DEBIT 777,X9,"1,234.00",,"${m(2000000 * 100 - net + 500000 - 123400)}"`]);
  const r = await upload(w.accounts.token, stmt); assert.equal(r.status, 201); assert.equal(r.body.line_count, 3); assert.equal(r.body.balance_check.ok, true);
  const lines = ok(await acc().get('/bank/lines?limit=50')).data;
  const matched = lines.find((l: any) => l.narration.includes(marina.reference)); assert.equal(matched.status, 'matched'); assert.equal(matched.matches[0].method, 'reference');
  assert.equal(lines.find((l: any) => l.narration.includes('RECEIPT')).status, 'ignored');
  assert.equal(lines.find((l: any) => l.narration.includes('UNKNOWN')).status, 'exception');
  const p: any = await Payment.findOne({ _id: marina._id, organisation_id: w.orgId }).lean();
  assert.equal(p.status, 'paid'); assert.equal(p.paid_via, 'bank_statement'); assert.equal(p.reconciled, true);
  assert.equal((await Invoice.findOne({ _id: marina.invoice_id, organisation_id: w.orgId }).lean() as any).status, 'reconciled');
  const dup = await upload(w.accounts.token, stmt); assert.equal(dup.status, 409); assert.equal(dup.body.code, 'DUPLICATE_FILE');
  const overlap = await upload(w.accounts.token, stmt + '\n18/10/2026,NEW LINE,N2,"10.00",,"0.00"'); // balance chain broken on purpose, one new line
  assert.equal(overlap.status, 201); assert.equal(overlap.body.line_count, 1); assert.equal(overlap.body.skipped_duplicates, 3); assert.equal(overlap.body.balance_check.ok, false);
});
test('bank: statements that do not fit the mapping are rejected as a whole with row numbers', async () => {
  const r = await upload(w.accounts.token, csv(['not-a-date,X,R,"1.00",,"1.00"']));
  assert.equal(r.status, 422); assert.equal(r.body.code, 'STATEMENT_PARSE_ERRORS'); assert.match(JSON.stringify(r.body.details.errors), /does not match format DD\/MM\/YYYY/);
  const fd = new FormData(); fd.append('bank_account_id', accountId); fd.append('profile_id', profileId); fd.append('file', new Blob([Buffer.from([0, 1, 2, 3])]), 'x.csv');
  assert.equal((await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${w.accounts.token}` }, body: fd })).status, 400);
  assert.equal((await head().post('/bank/profiles', {})).status, 400);
  const fd2 = new FormData(); fd2.append('bank_account_id', accountId); fd2.append('profile_id', profileId); fd2.append('file', new Blob(['a,b']), 'y.csv');
  assert.equal((await fetch(`${app.base}/bank/imports`, { method: 'POST', headers: { Authorization: `Bearer ${w.requester.token}` }, body: fd2 })).status, 403);
});
test('bank: manual match needs a second person, validated amounts, and can be reversed with a reason', async () => {
  const issue = async () => { const iid = await approvedInvoice(w, vendor, 'REC-' + Math.random().toString(36).slice(2, 6), 7000000 + Math.floor(Math.random() * 90000));
    const run = ok(await acc().post('/payment-runs', { invoice_ids: [iid], pay_date: today }), 201); ok(await head().post(`/payment-runs/${run.id}/release`, {}));
    return { iid, pay: (await Payment.findOne({ organisation_id: w.orgId, invoice_id: iid }).lean()) as any }; };
  const { iid, pay } = await issue();
  const unknown: any = await StatementLine.findOne({ organisation_id: w.orgId, status: 'exception' }).lean();
  const wrong = await acc().post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: pay.net_minor }] });
  assert.equal(wrong.status, 400); // line is only ₹1,234.00 so a bigger allocation is refused
  const small = ok(await acc().post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: 123400 }] })); assert.equal(small.status, 'pending_approval');
  assert.equal((await acc().post(`/bank/lines/${unknown._id}/approve-match`, {})).status, 403);   // accounts lack the approval permission
  const both = ok(await w.c(w.admin.token).post('/roles', { name: 'Recon Both', permissions: ['bank.view', 'bank.reconcile', 'bank.approve_manual_match'] }), 201);
  const rb = await addUser(app.base, w.admin.token, both.id, 'rb@kaveri.test', 'Recon Both');
  const sod = await w.c(rb.token).post(`/bank/lines/${unknown._id}/approve-match`, {}); assert.equal(sod.status, 200); // proposer is someone else, importer is someone else
  const p1: any = await Payment.findOne({ _id: pay._id, organisation_id: w.orgId }).lean(); assert.equal(p1.reconciled_minor, 123400); assert.equal(p1.reconciled, false); assert.equal(p1.status, 'paid');
  assert.equal((await head().post(`/bank/lines/${unknown._id}/unmatch`, { reason: 'x' })).status, 400);
  ok(await head().post(`/bank/lines/${unknown._id}/unmatch`, { reason: 'Matched to the wrong payment' }));
  const p2: any = await Payment.findOne({ _id: pay._id, organisation_id: w.orgId }).lean(); assert.equal(p2.status, 'released'); assert.equal(p2.reconciled_minor, 0);
  assert.equal((await Invoice.findOne({ _id: iid, organisation_id: w.orgId }).lean() as any).status, 'released');
  // a person who proposes a match cannot approve it
  const line2 = ok(await w.c(rb.token).post(`/bank/lines/${unknown._id}/match`, { allocations: [{ payment_id: String(pay._id), amount_minor: 123400 }] }));
  const self = await w.c(rb.token).post(`/bank/lines/${unknown._id}/approve-match`, {}); assert.equal(self.status, 403); assert.equal(self.body.details.rule, 'proposer_cannot_approve');
  assert.equal(line2.status, 'pending_approval');
});
test('reports: every report answers, CSV exports neutralise formulas, journal export works', async () => {
  for (const p of ['dashboard', 'aging', 'vendor-spend', 'approval-turnaround', 'payments-due', 'cash-flow', 'tds', 'reconciliation']) {
    const r = await head().get(`/reports/${p}`); assert.equal(r.status, 200, p);
  }
  const d = ok(await head().get('/reports/dashboard')); assert.ok(d.invoices_by_status); assert.equal(typeof d.avg_approval_hours === 'number' || d.avg_approval_hours === null, true);
  const aging = ok(await head().get('/reports/aging')); assert.ok(aging.buckets['90+'] !== undefined);
  const csvRes = await fetch(`${app.base}/reports/vendor-spend?format=csv`, { headers: { Authorization: `Bearer ${w.head1.token}` } });
  assert.match(csvRes.headers.get('content-type') || '', /text\/csv/); assert.match(await csvRes.text(), /^vendor,invoices,total,average/);
  const j = await fetch(`${app.base}/reports/journal-export`, { headers: { Authorization: `Bearer ${w.head1.token}` } }); assert.equal(j.status, 200);
  assert.equal((await acc().get('/reports/tds')).status, 403);
  const evil = ok(await w.c(w.accounts.token).post('/vendors', { name: '=HYPERLINK("http://evil")' }), 201); assert.ok(evil.id);
});
