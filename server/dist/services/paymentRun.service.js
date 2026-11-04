"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDto = exports.paymentDto = exports.notConfiguredPayoutProvider = exports.genericCsvExporter = void 0;
exports.prepareRun = prepareRun;
exports.cancelRun = cancelRun;
exports.holdPayment = holdPayment;
exports.releaseHold = releaseHold;
exports.releaseRun = releaseRun;
exports.downloadRunFile = downloadRunFile;
exports.confirmPaid = confirmPaid;
exports.markFailed = markFailed;
exports.listRuns = listRuns;
exports.getRun = getRun;
exports.listPayments = listPayments;
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const stateMachine_1 = require("../domain/stateMachine");
const policy_1 = require("../domain/policy");
const org_service_1 = require("./org.service");
const crypto_1 = require("../lib/crypto");
const storage_1 = require("./storage");
const notification_service_1 = require("./notification.service");
const paginate_1 = require("../lib/paginate");
const csv_1 = require("../lib/csv");
const models_2 = require("../models");
const major = (m) => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;
exports.genericCsvExporter = {
    id: 'generic_csv',
    generate(rows, runNumber) {
        const content = (0, csv_1.toCsv)(['reference', 'beneficiary_name', 'account_number', 'ifsc', 'amount', 'currency', 'narration', 'pay_date'], rows.map((r) => [r.reference, r.beneficiary_name, r.account_number, r.ifsc, major(r.amount_minor), r.currency, r.narration, r.pay_date.toISOString().slice(0, 10)]));
        return { filename: `${runNumber}.csv`, content, mime: 'text/csv' };
    },
};
exports.notConfiguredPayoutProvider = { id: 'none', send: async () => { throw (0, errors_1.notConfigured)('No payout provider is configured. Download the payment file and upload it to your bank, then confirm payments through bank statement reconciliation.'); } };
async function nextSeq(key, session) {
    const c = await models_1.Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    return c.seq;
}
const paymentDto = (p) => ({
    id: String(p._id), run_id: String(p.run_id), invoice_id: String(p.invoice_id), vendor_id: String(p.vendor_id), reference: p.reference, vendor_name: p.vendor_name, invoice_number: p.invoice_number,
    gross_minor: p.gross_minor, tds_minor: p.tds_minor, net_minor: p.net_minor, status: p.status, hold_reason: p.hold_reason, released_at: p.released_at, paid_at: p.paid_at, paid_via: p.paid_via,
    bank_reference: p.bank_reference, reconciled_minor: p.reconciled_minor, reconciled: p.reconciled, failure_reason: p.failure_reason,
    beneficiary: p.beneficiary ? { name: p.beneficiary.name, account_masked: p.beneficiary.account_last4 ? `••••${p.beneficiary.account_last4}` : '', ifsc: p.beneficiary.ifsc } : null,
});
exports.paymentDto = paymentDto;
const runDto = (r) => ({
    id: String(r._id), number: r.number, status: r.status, prepared_by: String(r.prepared_by), pay_date: r.pay_date, notes: r.notes, count: r.count, gross_minor: r.gross_minor, tds_minor: r.tds_minor, net_minor: r.net_minor,
    required_signatures: r.required_signatures, signatures: (r.signatures || []).map((s) => ({ user_id: String(s.user_id), at: s.at })), has_file: !!r.file?.key, released_at: r.released_at, createdAt: r.createdAt,
});
exports.runDto = runDto;
async function prepareRun(actor, input) {
    const ids = Array.from(new Set(input.invoice_ids));
    if (!ids.length)
        throw (0, errors_1.badRequest)('Select at least one invoice.');
    const invoices = await models_1.Invoice.find({ organisation_id: actor.orgId, _id: { $in: ids } });
    const notApproved = ids.filter((id) => { const i = invoices.find((x) => String(x._id) === id); return !i || i.status !== 'approved'; });
    if (notApproved.length)
        throw (0, errors_1.conflict)('Only fully approved invoices can be added to a payment run.', 'NOT_APPROVED', { invoice_ids: notApproved });
    const vendors = new Map((await models_1.Vendor.find({ organisation_id: actor.orgId, _id: { $in: invoices.map((i) => i.vendor_id) } }).lean()).map((v) => [String(v._id), v]));
    for (const i of invoices) {
        const v = vendors.get(String(i.vendor_id));
        if (!v || v.status !== 'active')
            throw (0, errors_1.conflict)(`Vendor of invoice ${i.number} is not active.`, 'VENDOR_NOT_ACTIVE');
        if (!v.bank?.account_number_enc)
            throw (0, errors_1.conflict)(`Vendor of invoice ${i.number} has no bank details.`, 'VENDOR_NO_BANK');
    }
    const sod = await (0, org_service_1.getSod)(actor.orgId);
    const net = invoices.reduce((a, i) => a + i.net_payable_minor, 0);
    return (0, txn_1.withTxn)(async (session) => {
        const year = new Date().getUTCFullYear();
        const [run] = await models_1.PaymentRun.create([{ organisation_id: actor.orgId, number: `PR-${year}-${String(await nextSeq(`run:${actor.orgId}:${year}`, session)).padStart(4, '0')}`, status: 'draft',
                prepared_by: actor.userId, pay_date: input.pay_date, notes: input.notes, count: invoices.length, gross_minor: invoices.reduce((a, i) => a + i.total_minor, 0),
                tds_minor: invoices.reduce((a, i) => a + i.tds_minor, 0), net_minor: net, required_signatures: (0, policy_1.requiredSignatures)(sod, net), signatures: [] }], { session });
        const pays = [];
        for (const i of invoices) {
            const v = vendors.get(String(i.vendor_id));
            pays.push({ organisation_id: actor.orgId, run_id: run._id, invoice_id: i._id, vendor_id: i.vendor_id, reference: `PMT-${year}-${String(await nextSeq(`pmt:${actor.orgId}:${year}`, session)).padStart(6, '0')}`,
                vendor_name: v.name, invoice_number: i.number, gross_minor: i.total_minor, tds_minor: i.tds_minor, net_minor: i.net_payable_minor, status: 'scheduled',
                beneficiary: { name: v.bank.account_name, account_last4: v.bank.account_last4, ifsc: v.bank.ifsc } });
            i.status = (0, stateMachine_1.assertTransition)(i.status, 'schedule');
            await i.save({ session });
        }
        await models_1.Payment.create(pays, { session, ordered: true });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment_run.prepared', entity_type: 'PaymentRun', entity_id: run._id, new_values: { number: run.number, count: invoices.length, net_minor: net, required_signatures: run.required_signatures } }, session);
        const roles = (await models_2.Role.find({ organisation_id: actor.orgId, permissions: 'payment.release_run' }).lean()).map((r) => r._id);
        const releasers = (await models_1.User.find({ organisation_id: actor.orgId, is_active: true, role_id: { $in: roles }, _id: { $ne: actor.userId } }).lean()).map((u) => u._id);
        await (0, notification_service_1.notifyMany)(actor.orgId, releasers, { kind: 'run.ready', title: `Payment run ${run.number} awaits release`, body: `${invoices.length} payments, net ${net / 100}`, entity_type: 'PaymentRun', entity_id: run._id }, session);
        return (0, exports.runDto)(run);
    });
}
async function unscheduleInvoices(orgId, invoiceIds, session) {
    for (const inv of await models_1.Invoice.find({ organisation_id: orgId, _id: { $in: invoiceIds } }).session(session || null)) {
        if (inv.status === 'scheduled') {
            inv.status = (0, stateMachine_1.assertTransition)('scheduled', 'unschedule');
            await inv.save({ session });
        }
    }
}
async function cancelRun(actor, id, reason) {
    if (!reason || reason.trim().length < 5)
        throw (0, errors_1.badRequest)('A reason is required to cancel a run.');
    const run = await models_1.PaymentRun.findOne({ _id: id, organisation_id: actor.orgId });
    if (!run)
        throw (0, errors_1.notFound)('Payment run');
    if (run.status !== 'draft')
        throw (0, errors_1.conflict)(`A ${run.status} run cannot be cancelled.`, 'INVALID_STATE');
    return (0, txn_1.withTxn)(async (session) => {
        const pays = await models_1.Payment.find({ organisation_id: actor.orgId, run_id: id }).session(session || null);
        await models_1.Payment.updateMany({ organisation_id: actor.orgId, run_id: id }, { $set: { status: 'cancelled' } }, { session });
        await unscheduleInvoices(actor.orgId, pays.map((p) => p.invoice_id), session);
        run.status = 'cancelled';
        run.cancelled_by = actor.userId;
        run.cancel_reason = reason;
        await run.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment_run.cancelled', entity_type: 'PaymentRun', entity_id: id, metadata: { reason } }, session);
        return (0, exports.runDto)(run);
    });
}
async function holdPayment(actor, id, reason) {
    if (!reason || reason.trim().length < 5)
        throw (0, errors_1.badRequest)('A reason of at least 5 characters is required to hold a payment.');
    const p = await models_1.Payment.findOne({ _id: id, organisation_id: actor.orgId });
    if (!p)
        throw (0, errors_1.notFound)('Payment');
    if (p.status !== 'scheduled')
        throw (0, errors_1.conflict)(`A payment that is ${p.status} cannot be held.`, 'INVALID_STATE');
    return (0, txn_1.withTxn)(async (session) => {
        p.status = 'held';
        p.hold_reason = reason;
        p.held_by = actor.userId;
        await p.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment.held', entity_type: 'Payment', entity_id: id, metadata: { reason } }, session);
        return (0, exports.paymentDto)(p);
    });
}
async function releaseHold(actor, id, note) {
    const p = await models_1.Payment.findOne({ _id: id, organisation_id: actor.orgId });
    if (!p)
        throw (0, errors_1.notFound)('Payment');
    if (p.status !== 'held')
        throw (0, errors_1.conflict)('This payment is not on hold.', 'INVALID_STATE');
    const run = await models_1.PaymentRun.findOne({ _id: p.run_id, organisation_id: actor.orgId }).lean();
    if (run?.status !== 'draft')
        throw (0, errors_1.conflict)('The run was already released; this payment must go into a new run.', 'INVALID_STATE');
    return (0, txn_1.withTxn)(async (session) => {
        p.status = 'scheduled';
        p.hold_released_by = actor.userId;
        await p.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment.hold_released', entity_type: 'Payment', entity_id: id, metadata: { note } }, session);
        return (0, exports.paymentDto)(p);
    });
}
/**
 * Release a run. Needs payment.release_run, must not be the preparer, and above the dual-signature threshold needs two distinct people.
 * Held payments are carved out of the run. The bank file is generated here; payments only become PAID when the bank confirms.
 */
async function releaseRun(actor, id, exporter = exports.genericCsvExporter) {
    const existing = await models_1.PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!existing)
        throw (0, errors_1.notFound)('Payment run');
    if (existing.status === 'released')
        return { run: (0, exports.runDto)(existing), state: 'released', idempotent: true };
    if (existing.status === 'cancelled')
        throw (0, errors_1.conflict)('This run was cancelled.', 'INVALID_STATE');
    const sod = await (0, org_service_1.getSod)(actor.orgId);
    const viol = (0, policy_1.checkRunRelease)(sod, actor.userId, existing);
    if (viol)
        throw (0, errors_1.forbidden)(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
    return (0, txn_1.withTxn)(async (session) => {
        const run = await models_1.PaymentRun.findOne({ _id: id, organisation_id: actor.orgId, status: 'draft' }).session(session || null);
        if (!run)
            throw (0, errors_1.conflict)('This run is no longer waiting for release.', 'INVALID_STATE');
        const again = (0, policy_1.checkRunRelease)(sod, actor.userId, run);
        if (again)
            throw (0, errors_1.forbidden)(again.message, 'SOD_VIOLATION', { rule: again.rule });
        run.signatures.push({ user_id: actor.userId, at: new Date() });
        if (run.signatures.length < run.required_signatures) {
            await run.save({ session });
            await (0, audit_service_1.writeAudit)(actor, { action: 'payment_run.signed', entity_type: 'PaymentRun', entity_id: id, metadata: { signatures: run.signatures.length, required: run.required_signatures } }, session);
            return { run: (0, exports.runDto)(run), state: 'awaiting_signature', signatures_needed: run.required_signatures - run.signatures.length, idempotent: false };
        }
        const pays = await models_1.Payment.find({ organisation_id: actor.orgId, run_id: id }).session(session || null);
        const held = pays.filter((p) => p.status === 'held');
        const live = pays.filter((p) => p.status === 'scheduled');
        if (!live.length)
            throw (0, errors_1.conflict)('There are no payments left to release in this run.', 'NOTHING_TO_RELEASE');
        const now = new Date();
        for (const p of held) {
            p.status = 'cancelled';
            p.failure_reason = 'Held when the run was released; schedule it again in a new run.';
            await p.save({ session });
        }
        await unscheduleInvoices(actor.orgId, held.map((p) => p.invoice_id), session);
        const vendors = new Map((await models_1.Vendor.find({ organisation_id: actor.orgId, _id: { $in: live.map((p) => p.vendor_id) } }).lean().session(session || null)).map((v) => [String(v._id), v]));
        const rows = live.map((p) => {
            const v = vendors.get(String(p.vendor_id));
            return { reference: p.reference, beneficiary_name: v.bank.account_name, account_number: (0, crypto_1.decryptSecret)(v.bank.account_number_enc),
                ifsc: v.bank.ifsc, amount_minor: p.net_minor, currency: 'INR', narration: p.reference, pay_date: run.pay_date };
        });
        const out = exporter.generate(rows, run.number);
        const saved = await (0, storage_1.storage)().save(Buffer.from(out.content, 'utf8'), out.filename, out.mime, `${actor.orgId}/payment-files`);
        for (const p of live) {
            p.status = 'released';
            p.released_at = now;
            await p.save({ session });
        }
        for (const inv of await models_1.Invoice.find({ organisation_id: actor.orgId, _id: { $in: live.map((p) => p.invoice_id) } }).session(session || null)) {
            inv.status = (0, stateMachine_1.assertTransition)(inv.status, 'release');
            await inv.save({ session });
        }
        run.status = 'released';
        run.released_at = now;
        run.count = live.length;
        run.net_minor = live.reduce((a, p) => a + p.net_minor, 0);
        run.gross_minor = live.reduce((a, p) => a + p.gross_minor, 0);
        run.tds_minor = live.reduce((a, p) => a + p.tds_minor, 0);
        run.file = { key: saved.key, name: out.filename, hash: saved.fileHash, generated_at: now };
        await run.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment_run.released', entity_type: 'PaymentRun', entity_id: id, new_values: { count: live.length, net_minor: run.net_minor, file_hash: saved.fileHash, held_removed: held.length, exporter: exporter.id } }, session);
        return { run: (0, exports.runDto)(run), state: 'released', idempotent: false };
    });
}
async function downloadRunFile(actor, id) {
    const run = await models_1.PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!run?.file?.key)
        throw (0, errors_1.notFound)('Payment file');
    const buf = await (0, storage_1.storage)().read(run.file.key);
    if ((0, crypto_1.sha256)(buf) !== run.file.hash)
        throw (0, errors_1.conflict)('The stored payment file does not match its recorded hash.', 'FILE_TAMPERED');
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'payment_run.file_downloaded', entity_type: 'PaymentRun', entity_id: id }, s));
    return { buffer: buf, name: run.file.name };
}
async function confirmPaid(actor, id, input) {
    const p = await models_1.Payment.findOne({ _id: id, organisation_id: actor.orgId });
    if (!p)
        throw (0, errors_1.notFound)('Payment');
    if (p.status !== 'released')
        throw (0, errors_1.conflict)(`Only released payments can be confirmed paid (this one is ${p.status}).`, 'INVALID_STATE');
    return (0, txn_1.withTxn)(async (session) => {
        p.status = 'paid';
        p.paid_at = input.paid_date || new Date();
        p.paid_via = 'manual';
        p.bank_reference = input.bank_reference;
        p.utr = input.bank_reference;
        p.confirmed_by = actor.userId;
        await p.save({ session });
        const inv = await models_1.Invoice.findOne({ _id: p.invoice_id, organisation_id: actor.orgId }).session(session || null);
        inv.status = (0, stateMachine_1.assertTransition)(inv.status, 'paid');
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment.confirmed_paid', entity_type: 'Payment', entity_id: id, metadata: { bank_reference: input.bank_reference, via: 'manual' } }, session);
        return (0, exports.paymentDto)(p);
    });
}
async function markFailed(actor, id, reason) {
    if (!reason || reason.trim().length < 5)
        throw (0, errors_1.badRequest)('A reason is required.');
    const p = await models_1.Payment.findOne({ _id: id, organisation_id: actor.orgId });
    if (!p)
        throw (0, errors_1.notFound)('Payment');
    if (p.status !== 'released')
        throw (0, errors_1.conflict)(`Only released payments can be marked failed (this one is ${p.status}).`, 'INVALID_STATE');
    return (0, txn_1.withTxn)(async (session) => {
        p.status = 'failed';
        p.failure_reason = reason;
        await p.save({ session });
        const inv = await models_1.Invoice.findOne({ _id: p.invoice_id, organisation_id: actor.orgId }).session(session || null);
        inv.status = (0, stateMachine_1.assertTransition)(inv.status, 'fail');
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'payment.failed', entity_type: 'Payment', entity_id: id, metadata: { reason } }, session);
        return (0, exports.paymentDto)(p);
    });
}
async function listRuns(actor, req) {
    const f = { organisation_id: actor.orgId };
    if (req.query.status)
        f.status = String(req.query.status);
    const page = await (0, paginate_1.paginate)(models_1.PaymentRun.find(f).sort({ createdAt: -1 }), models_1.PaymentRun.countDocuments(f), req);
    return { ...page, data: page.data.map(exports.runDto) };
}
async function getRun(actor, id) {
    const run = await models_1.PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!run)
        throw (0, errors_1.notFound)('Payment run');
    const pays = await models_1.Payment.find({ organisation_id: actor.orgId, run_id: id }).sort({ reference: 1 }).lean();
    const sod = await (0, org_service_1.getSod)(actor.orgId);
    const viol = (0, policy_1.checkRunRelease)(sod, actor.userId, run);
    return { ...(0, exports.runDto)(run), payments: pays.map(exports.paymentDto), can_release_by_policy: !viol, policy_message: viol?.message || null };
}
async function listPayments(actor, req) {
    const f = { organisation_id: actor.orgId };
    for (const k of ['status', 'run_id', 'vendor_id'])
        if (req.query[k])
            f[k] = String(req.query[k]);
    const page = await (0, paginate_1.paginate)(models_1.Payment.find(f).sort({ createdAt: -1 }), models_1.Payment.countDocuments(f), req);
    return { ...page, data: page.data.map(exports.paymentDto) };
}
//# sourceMappingURL=paymentRun.service.js.map