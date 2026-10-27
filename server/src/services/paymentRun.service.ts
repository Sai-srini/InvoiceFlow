import { Request } from 'express';
import { Invoice, Vendor, Payment, PaymentRun, Counter, User } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, forbidden, notFound, notConfigured } from '../lib/errors';
import { assertTransition } from '../domain/stateMachine';
import { checkRunRelease, requiredSignatures } from '../domain/policy';
import { getSod } from './org.service';
import { decryptSecret, sha256 } from '../lib/crypto';
import { storage } from './storage';
import { notifyMany } from './notification.service';
import { paginate } from '../lib/paginate';
import { toCsv } from '../lib/csv';
import { Role } from '../models';

// ---------- pluggable bank interfaces. Only a generic CSV exporter exists; no bank API is invented.
export interface ExportRow { reference: string; beneficiary_name: string; account_number: string; ifsc: string; amount_minor: number; currency: string; narration: string; pay_date: Date; }
export interface PaymentFileExporter { id: string; generate(rows: ExportRow[], runNumber: string): { filename: string; content: string; mime: string }; }
const major = (m: number) => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;
export const genericCsvExporter: PaymentFileExporter = {
  id: 'generic_csv',
  generate(rows, runNumber) {
    const content = toCsv(['reference', 'beneficiary_name', 'account_number', 'ifsc', 'amount', 'currency', 'narration', 'pay_date'],
      rows.map((r) => [r.reference, r.beneficiary_name, r.account_number, r.ifsc, major(r.amount_minor), r.currency, r.narration, r.pay_date.toISOString().slice(0, 10)]));
    return { filename: `${runNumber}.csv`, content, mime: 'text/csv' };
  },
};
export interface PayoutProvider { id: string; send(runId: string): Promise<never>; }
export const notConfiguredPayoutProvider: PayoutProvider = { id: 'none', send: async () => { throw notConfigured('No payout provider is configured. Download the payment file and upload it to your bank, then confirm payments through bank statement reconciliation.'); } };

async function nextSeq(key: string, session: any): Promise<number> {
  const c: any = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
  return c.seq;
}

export const paymentDto = (p: any) => ({
  id: String(p._id), run_id: String(p.run_id), invoice_id: String(p.invoice_id), vendor_id: String(p.vendor_id), reference: p.reference, vendor_name: p.vendor_name, invoice_number: p.invoice_number,
  gross_minor: p.gross_minor, tds_minor: p.tds_minor, net_minor: p.net_minor, status: p.status, hold_reason: p.hold_reason, released_at: p.released_at, paid_at: p.paid_at, paid_via: p.paid_via,
  bank_reference: p.bank_reference, reconciled_minor: p.reconciled_minor, reconciled: p.reconciled, failure_reason: p.failure_reason,
  beneficiary: p.beneficiary ? { name: p.beneficiary.name, account_masked: p.beneficiary.account_last4 ? `••••${p.beneficiary.account_last4}` : '', ifsc: p.beneficiary.ifsc } : null,
});
export const runDto = (r: any) => ({
  id: String(r._id), number: r.number, status: r.status, prepared_by: String(r.prepared_by), pay_date: r.pay_date, notes: r.notes, count: r.count, gross_minor: r.gross_minor, tds_minor: r.tds_minor, net_minor: r.net_minor,
  required_signatures: r.required_signatures, signatures: (r.signatures || []).map((s: any) => ({ user_id: String(s.user_id), at: s.at })), has_file: !!r.file?.key, released_at: r.released_at, createdAt: r.createdAt,
});

export async function prepareRun(actor: Actor, input: { invoice_ids: string[]; pay_date: Date; notes?: string }) {
  const ids = Array.from(new Set(input.invoice_ids));
  if (!ids.length) throw badRequest('Select at least one invoice.');
  const invoices: any[] = await Invoice.find({ organisation_id: actor.orgId, _id: { $in: ids } });
  const notApproved = ids.filter((id) => { const i = invoices.find((x) => String(x._id) === id); return !i || i.status !== 'approved'; });
  if (notApproved.length) throw conflict('Only fully approved invoices can be added to a payment run.', 'NOT_APPROVED', { invoice_ids: notApproved });
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: invoices.map((i) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v]));
  for (const i of invoices) {
    const v: any = vendors.get(String(i.vendor_id));
    if (!v || v.status !== 'active') throw conflict(`Vendor of invoice ${i.number} is not active.`, 'VENDOR_NOT_ACTIVE');
    if (!v.bank?.account_number_enc) throw conflict(`Vendor of invoice ${i.number} has no bank details.`, 'VENDOR_NO_BANK');
  }
  const sod = await getSod(actor.orgId);
  const net = invoices.reduce((a, i) => a + i.net_payable_minor, 0);
  return withTxn(async (session) => {
    const year = new Date().getUTCFullYear();
    const [run]: any = await PaymentRun.create([{ organisation_id: actor.orgId, number: `PR-${year}-${String(await nextSeq(`run:${actor.orgId}:${year}`, session)).padStart(4, '0')}`, status: 'draft',
      prepared_by: actor.userId, pay_date: input.pay_date, notes: input.notes, count: invoices.length, gross_minor: invoices.reduce((a, i) => a + i.total_minor, 0),
      tds_minor: invoices.reduce((a, i) => a + i.tds_minor, 0), net_minor: net, required_signatures: requiredSignatures(sod, net), signatures: [] }], { session });
    const pays: any[] = [];
    for (const i of invoices) {
      const v: any = vendors.get(String(i.vendor_id));
      pays.push({ organisation_id: actor.orgId, run_id: run._id, invoice_id: i._id, vendor_id: i.vendor_id, reference: `PMT-${year}-${String(await nextSeq(`pmt:${actor.orgId}:${year}`, session)).padStart(6, '0')}`,
        vendor_name: v.name, invoice_number: i.number, gross_minor: i.total_minor, tds_minor: i.tds_minor, net_minor: i.net_payable_minor, status: 'scheduled',
        beneficiary: { name: v.bank.account_name, account_last4: v.bank.account_last4, ifsc: v.bank.ifsc } });
      i.status = assertTransition(i.status, 'schedule'); await i.save({ session });
    }
    await Payment.create(pays, { session, ordered: true });
    await writeAudit(actor, { action: 'payment_run.prepared', entity_type: 'PaymentRun', entity_id: run._id, new_values: { number: run.number, count: invoices.length, net_minor: net, required_signatures: run.required_signatures } }, session);
    const roles = (await Role.find({ organisation_id: actor.orgId, permissions: 'payment.release_run' }).lean()).map((r: any) => r._id);
    const releasers = (await User.find({ organisation_id: actor.orgId, is_active: true, role_id: { $in: roles }, _id: { $ne: actor.userId } }).lean()).map((u: any) => u._id);
    await notifyMany(actor.orgId, releasers, { kind: 'run.ready', title: `Payment run ${run.number} awaits release`, body: `${invoices.length} payments, net ${net / 100}`, entity_type: 'PaymentRun', entity_id: run._id }, session);
    return runDto(run);
  });
}

async function unscheduleInvoices(orgId: string, invoiceIds: any[], session: any) {
  for (const inv of await Invoice.find({ organisation_id: orgId, _id: { $in: invoiceIds } }).session(session || null)) {
    if (inv.status === 'scheduled') { inv.status = assertTransition('scheduled', 'unschedule') as any; await inv.save({ session }); }
  }
}

export async function cancelRun(actor: Actor, id: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('A reason is required to cancel a run.');
  const run: any = await PaymentRun.findOne({ _id: id, organisation_id: actor.orgId });
  if (!run) throw notFound('Payment run');
  if (run.status !== 'draft') throw conflict(`A ${run.status} run cannot be cancelled.`, 'INVALID_STATE');
  return withTxn(async (session) => {
    const pays: any[] = await Payment.find({ organisation_id: actor.orgId, run_id: id }).session(session || null);
    await Payment.updateMany({ organisation_id: actor.orgId, run_id: id }, { $set: { status: 'cancelled' } }, { session });
    await unscheduleInvoices(actor.orgId, pays.map((p) => p.invoice_id), session);
    run.status = 'cancelled'; run.cancelled_by = actor.userId; run.cancel_reason = reason; await run.save({ session });
    await writeAudit(actor, { action: 'payment_run.cancelled', entity_type: 'PaymentRun', entity_id: id, metadata: { reason } }, session);
    return runDto(run);
  });
}

export async function holdPayment(actor: Actor, id: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('A reason of at least 5 characters is required to hold a payment.');
  const p: any = await Payment.findOne({ _id: id, organisation_id: actor.orgId });
  if (!p) throw notFound('Payment');
  if (p.status !== 'scheduled') throw conflict(`A payment that is ${p.status} cannot be held.`, 'INVALID_STATE');
  return withTxn(async (session) => {
    p.status = 'held'; p.hold_reason = reason; p.held_by = actor.userId; await p.save({ session });
    await writeAudit(actor, { action: 'payment.held', entity_type: 'Payment', entity_id: id, metadata: { reason } }, session);
    return paymentDto(p);
  });
}
export async function releaseHold(actor: Actor, id: string, note?: string) {
  const p: any = await Payment.findOne({ _id: id, organisation_id: actor.orgId });
  if (!p) throw notFound('Payment');
  if (p.status !== 'held') throw conflict('This payment is not on hold.', 'INVALID_STATE');
  const run: any = await PaymentRun.findOne({ _id: p.run_id, organisation_id: actor.orgId }).lean();
  if (run?.status !== 'draft') throw conflict('The run was already released; this payment must go into a new run.', 'INVALID_STATE');
  return withTxn(async (session) => {
    p.status = 'scheduled'; p.hold_released_by = actor.userId; await p.save({ session });
    await writeAudit(actor, { action: 'payment.hold_released', entity_type: 'Payment', entity_id: id, metadata: { note } }, session);
    return paymentDto(p);
  });
}

/**
 * Release a run. Needs payment.release_run, must not be the preparer, and above the dual-signature threshold needs two distinct people.
 * Held payments are carved out of the run. The bank file is generated here; payments only become PAID when the bank confirms.
 */
export async function releaseRun(actor: Actor, id: string, exporter: PaymentFileExporter = genericCsvExporter) {
  const existing: any = await PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean();
  if (!existing) throw notFound('Payment run');
  if (existing.status === 'released') return { run: runDto(existing), state: 'released', idempotent: true };
  if (existing.status === 'cancelled') throw conflict('This run was cancelled.', 'INVALID_STATE');
  const sod = await getSod(actor.orgId);
  const viol = checkRunRelease(sod, actor.userId, existing);
  if (viol) throw forbidden(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
  return withTxn(async (session) => {
    const run: any = await PaymentRun.findOne({ _id: id, organisation_id: actor.orgId, status: 'draft' }).session(session || null);
    if (!run) throw conflict('This run is no longer waiting for release.', 'INVALID_STATE');
    const again = checkRunRelease(sod, actor.userId, run); if (again) throw forbidden(again.message, 'SOD_VIOLATION', { rule: again.rule });
    run.signatures.push({ user_id: actor.userId, at: new Date() });
    if (run.signatures.length < run.required_signatures) {
      await run.save({ session });
      await writeAudit(actor, { action: 'payment_run.signed', entity_type: 'PaymentRun', entity_id: id, metadata: { signatures: run.signatures.length, required: run.required_signatures } }, session);
      return { run: runDto(run), state: 'awaiting_signature', signatures_needed: run.required_signatures - run.signatures.length, idempotent: false };
    }
    const pays: any[] = await Payment.find({ organisation_id: actor.orgId, run_id: id }).session(session || null);
    const held = pays.filter((p) => p.status === 'held'); const live = pays.filter((p) => p.status === 'scheduled');
    if (!live.length) throw conflict('There are no payments left to release in this run.', 'NOTHING_TO_RELEASE');
    const now = new Date();
    for (const p of held) { p.status = 'cancelled'; p.failure_reason = 'Held when the run was released; schedule it again in a new run.'; await p.save({ session }); }
    await unscheduleInvoices(actor.orgId, held.map((p) => p.invoice_id), session);
    const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: live.map((p) => p.vendor_id) } }).lean().session(session || null)).map((v: any) => [String(v._id), v]));
    const rows: ExportRow[] = live.map((p) => { const v: any = vendors.get(String(p.vendor_id)); return { reference: p.reference, beneficiary_name: v.bank.account_name, account_number: decryptSecret(v.bank.account_number_enc),
      ifsc: v.bank.ifsc, amount_minor: p.net_minor, currency: 'INR', narration: p.reference, pay_date: run.pay_date }; });
    const out = exporter.generate(rows, run.number);
    const saved = await storage().save(Buffer.from(out.content, 'utf8'), out.filename, out.mime, `${actor.orgId}/payment-files`);
    for (const p of live) { p.status = 'released'; p.released_at = now; await p.save({ session }); }
    for (const inv of await Invoice.find({ organisation_id: actor.orgId, _id: { $in: live.map((p) => p.invoice_id) } }).session(session || null)) { inv.status = assertTransition(inv.status, 'release') as any; await inv.save({ session }); }
    run.status = 'released'; run.released_at = now; run.count = live.length; run.net_minor = live.reduce((a, p) => a + p.net_minor, 0); run.gross_minor = live.reduce((a, p) => a + p.gross_minor, 0); run.tds_minor = live.reduce((a, p) => a + p.tds_minor, 0);
    run.file = { key: saved.key, name: out.filename, hash: saved.fileHash, generated_at: now };
    await run.save({ session });
    await writeAudit(actor, { action: 'payment_run.released', entity_type: 'PaymentRun', entity_id: id, new_values: { count: live.length, net_minor: run.net_minor, file_hash: saved.fileHash, held_removed: held.length, exporter: exporter.id } }, session);
    return { run: runDto(run), state: 'released', idempotent: false };
  });
}

export async function downloadRunFile(actor: Actor, id: string) {
  const run: any = await PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean();
  if (!run?.file?.key) throw notFound('Payment file');
  const buf = await storage().read(run.file.key);
  if (sha256(buf) !== run.file.hash) throw conflict('The stored payment file does not match its recorded hash.', 'FILE_TAMPERED');
  await withTxn((s) => writeAudit(actor, { action: 'payment_run.file_downloaded', entity_type: 'PaymentRun', entity_id: id }, s));
  return { buffer: buf, name: run.file.name };
}

export async function confirmPaid(actor: Actor, id: string, input: { bank_reference: string; paid_date?: Date }) {
  const p: any = await Payment.findOne({ _id: id, organisation_id: actor.orgId });
  if (!p) throw notFound('Payment');
  if (p.status !== 'released') throw conflict(`Only released payments can be confirmed paid (this one is ${p.status}).`, 'INVALID_STATE');
  return withTxn(async (session) => {
    p.status = 'paid'; p.paid_at = input.paid_date || new Date(); p.paid_via = 'manual'; p.bank_reference = input.bank_reference; p.utr = input.bank_reference; p.confirmed_by = actor.userId; await p.save({ session });
    const inv: any = await Invoice.findOne({ _id: p.invoice_id, organisation_id: actor.orgId }).session(session || null);
    inv.status = assertTransition(inv.status, 'paid'); await inv.save({ session });
    await writeAudit(actor, { action: 'payment.confirmed_paid', entity_type: 'Payment', entity_id: id, metadata: { bank_reference: input.bank_reference, via: 'manual' } }, session);
    return paymentDto(p);
  });
}
export async function markFailed(actor: Actor, id: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('A reason is required.');
  const p: any = await Payment.findOne({ _id: id, organisation_id: actor.orgId });
  if (!p) throw notFound('Payment');
  if (p.status !== 'released') throw conflict(`Only released payments can be marked failed (this one is ${p.status}).`, 'INVALID_STATE');
  return withTxn(async (session) => {
    p.status = 'failed'; p.failure_reason = reason; await p.save({ session });
    const inv: any = await Invoice.findOne({ _id: p.invoice_id, organisation_id: actor.orgId }).session(session || null);
    inv.status = assertTransition(inv.status, 'fail'); await inv.save({ session });
    await writeAudit(actor, { action: 'payment.failed', entity_type: 'Payment', entity_id: id, metadata: { reason } }, session);
    return paymentDto(p);
  });
}

export async function listRuns(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId }; if (req.query.status) f.status = String(req.query.status);
  const page = await paginate(PaymentRun.find(f).sort({ createdAt: -1 }), PaymentRun.countDocuments(f), req);
  return { ...page, data: page.data.map(runDto) };
}
export async function getRun(actor: Actor, id: string) {
  const run: any = await PaymentRun.findOne({ _id: id, organisation_id: actor.orgId }).lean(); if (!run) throw notFound('Payment run');
  const pays = await Payment.find({ organisation_id: actor.orgId, run_id: id }).sort({ reference: 1 }).lean();
  const sod = await getSod(actor.orgId);
  const viol = checkRunRelease(sod, actor.userId, run);
  return { ...runDto(run), payments: pays.map(paymentDto), can_release_by_policy: !viol, policy_message: viol?.message || null };
}
export async function listPayments(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId };
  for (const k of ['status', 'run_id', 'vendor_id']) if (req.query[k]) f[k] = String(req.query[k]);
  const page = await paginate(Payment.find(f).sort({ createdAt: -1 }), Payment.countDocuments(f), req);
  return { ...page, data: page.data.map(paymentDto) };
}
