import { Request } from 'express';
import ExcelJS from 'exceljs';
import { BankAccount, StatementProfile, StatementImport, StatementLine, ReconAllocation, Payment, Invoice, Organisation, User } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit, AuditActor } from './audit.service';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { assertTransition, nextStatus } from '../domain/stateMachine';
import { csvToRows, parseStatementRows, fingerprintLines, checkBalances, SUPPORTED_DATE_FORMATS, StatementProfileCfg } from '../domain/statementParser';
import { matchLines, MLine, MPay, DEFAULT_MATCH_CONFIG } from '../domain/matching';
import { checkMatchApproval } from '../domain/policy';
import { getSod } from './org.service';
import { paginate } from '../lib/paginate';
import { enqueue } from '../queues';
import mongoose from 'mongoose';

// ---------------- bank accounts & mapping profiles
export async function saveBankAccount(actor: Actor, id: string | null, input: any) {
  return withTxn(async (session) => {
    let a: any;
    if (id) { a = await BankAccount.findOne({ _id: id, organisation_id: actor.orgId }); if (!a) throw notFound('Bank account'); Object.assign(a, input); await a.save({ session }); }
    else [a] = await BankAccount.create([{ ...input, organisation_id: actor.orgId }], { session });
    await writeAudit(actor, { action: id ? 'bank_account.updated' : 'bank_account.created', entity_type: 'BankAccount', entity_id: a._id, new_values: input }, session);
    return a.toObject();
  });
}
export const listBankAccounts = (actor: Actor) => BankAccount.find({ organisation_id: actor.orgId }).sort({ name: 1 }).lean();

function validateProfile(p: any) {
  if (!SUPPORTED_DATE_FORMATS.includes(p.date_format)) throw badRequest(`Date format must be one of: ${SUPPORTED_DATE_FORMATS.join(', ')}`);
  if (p.amount_mode === 'separate' && (!p.debit_column || !p.credit_column)) throw badRequest('Debit and credit column names are required.');
  if (p.amount_mode !== 'separate' && !p.amount_column) throw badRequest('Amount column name is required.');
  if (p.amount_mode === 'amount_drcr' && !p.drcr_column) throw badRequest('Dr/Cr column name is required.');
}
export async function saveProfile(actor: Actor, id: string | null, input: any) {
  validateProfile(input);
  if (!(await BankAccount.findOne({ _id: input.bank_account_id, organisation_id: actor.orgId }).lean())) throw badRequest('Bank account not found.');
  return withTxn(async (session) => {
    let p: any;
    if (id) { p = await StatementProfile.findOne({ _id: id, organisation_id: actor.orgId }); if (!p) throw notFound('Profile'); Object.assign(p, input); await p.save({ session }); }
    else [p] = await StatementProfile.create([{ ...input, organisation_id: actor.orgId }], { session });
    await writeAudit(actor, { action: id ? 'statement_profile.updated' : 'statement_profile.created', entity_type: 'StatementProfile', entity_id: p._id, new_values: input }, session);
    return p.toObject();
  });
}
export const listProfiles = (actor: Actor, accountId?: string) => StatementProfile.find({ organisation_id: actor.orgId, ...(accountId ? { bank_account_id: accountId } : {}) }).lean();

// ---------------- parsing uploads
async function fileToRows(buffer: Buffer, format: 'csv' | 'xlsx'): Promise<{ rows: string[][]; excel: boolean }> {
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (format === 'xlsx' || isZip) {
    if (!isZip) throw badRequest('This file is not a valid Excel (.xlsx) workbook.');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The workbook has no sheets.');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const out: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v: any = row.getCell(c).value;
        if (v === null || v === undefined) out.push('');
        else if (v instanceof Date) out.push(v.toISOString().slice(0, 10));
        else if (typeof v === 'number') out.push(String(v));
        else if (typeof v === 'object') out.push(String(v.text ?? v.result ?? ''));
        else out.push(String(v));
      }
      rows.push(out);
    });
    return { rows, excel: true };
  }
  if (buffer.includes(0)) throw badRequest('This file does not look like a CSV text file.');
  return { rows: csvToRows(buffer.toString('utf8')), excel: false };
}
const toCfg = (p: any): StatementProfileCfg => ({ header_row: p.header_row, date_column: p.date_column, date_format: p.date_format, narration_column: p.narration_column, reference_column: p.reference_column,
  amount_mode: p.amount_mode, debit_column: p.debit_column, credit_column: p.credit_column, amount_column: p.amount_column, drcr_column: p.drcr_column, balance_column: p.balance_column,
  decimal_separator: p.decimal_separator, skip_footer_rows: p.skip_footer_rows });

/** Dry run: shows what a mapping would read, without saving anything. */
export async function previewParse(profile: any, file: Buffer) {
  validateProfile(profile);
  const { rows, excel } = await fileToRows(file, profile.format || 'csv');
  const r = parseStatementRows(rows, toCfg(profile), { forceDecimalDot: excel });
  return { header: rows[profile.header_row] || [], first_rows: rows.slice(0, 6), lines: r.lines.slice(0, 15), line_count: r.lines.length, errors: r.errors.slice(0, 20), balance_check: checkBalances(r.lines) };
}

export async function importStatement(actor: Actor, input: { bank_account_id: string; profile_id: string; file: Buffer; file_name: string }) {
  const account = await BankAccount.findOne({ _id: input.bank_account_id, organisation_id: actor.orgId }).lean();
  const profile: any = await StatementProfile.findOne({ _id: input.profile_id, organisation_id: actor.orgId, bank_account_id: input.bank_account_id }).lean();
  if (!account || !profile) throw badRequest('Bank account or mapping profile not found.');
  const fileHash = sha256(input.file);
  if (await StatementImport.findOne({ organisation_id: actor.orgId, bank_account_id: input.bank_account_id, file_hash: fileHash }).lean())
    throw conflict('This exact statement file was already imported for this account.', 'DUPLICATE_FILE');
  const { rows, excel } = await fileToRows(input.file, profile.format);
  const parsed = parseStatementRows(rows, toCfg(profile), { forceDecimalDot: excel });
  if (parsed.errors.length) throw new (require('../lib/errors').AppError)(422, 'STATEMENT_PARSE_ERRORS', `${parsed.errors.length} row(s) could not be read with this mapping. Nothing was imported.`, { errors: parsed.errors.slice(0, 30) });
  if (!parsed.lines.length) throw badRequest('No transaction rows were found.');
  const bal = checkBalances(parsed.lines);
  const withFp = fingerprintLines(input.bank_account_id, parsed.lines);
  const existing = new Set((await StatementLine.find({ organisation_id: actor.orgId, bank_account_id: input.bank_account_id, fingerprint: { $in: withFp.map((l) => l.fingerprint) } }).select('fingerprint').lean()).map((x: any) => x.fingerprint));
  const fresh = withFp.filter((l) => !existing.has(l.fingerprint));
  const dates = parsed.lines.map((l) => l.date.getTime());
  const imp = await withTxn(async (session) => {
    const [im]: any = await StatementImport.create([{ organisation_id: actor.orgId, bank_account_id: input.bank_account_id, profile_id: input.profile_id, uploaded_by: actor.userId, file_name: input.file_name.slice(0, 200), file_hash: fileHash,
      line_count: fresh.length, skipped_duplicates: withFp.length - fresh.length, period_from: new Date(Math.min(...dates)), period_to: new Date(Math.max(...dates)), opening_minor: bal.opening_minor, closing_minor: bal.closing_minor, balance_check: bal }], { session });
    if (fresh.length) await StatementLine.create(fresh.map((l) => ({ organisation_id: actor.orgId, import_id: im._id, bank_account_id: input.bank_account_id, row_number: l.row_number, date: l.date, narration: l.narration, reference: l.reference,
      debit_minor: l.debit_minor, credit_minor: l.credit_minor, balance_minor: l.balance_minor, fingerprint: l.fingerprint, status: l.debit_minor > 0 ? 'unmatched' : 'ignored' })), { session, ordered: true });
    await writeAudit(actor, { action: 'statement.imported', entity_type: 'StatementImport', entity_id: im._id, new_values: { file_hash: fileHash, lines: fresh.length, skipped_duplicates: withFp.length - fresh.length, balance_ok: bal.ok } }, session);
    return im;
  });
  await enqueue('recon.match', { orgId: actor.orgId, userId: actor.userId, importId: String(imp._id) });
  return { id: String(imp._id), line_count: fresh.length, skipped_duplicates: withFp.length - fresh.length, balance_check: bal };
}

export async function listImports(actor: Actor) { return StatementImport.find({ organisation_id: actor.orgId }).sort({ createdAt: -1 }).limit(100).lean(); }

// ---------------- applying and reversing allocations
async function applyAllocation(orgId: string, a: { line_id: any; payment_id: any; amount_minor: number }, session: any, audit: AuditActor, tol: number) {
  const line: any = await StatementLine.findOne({ _id: a.line_id, organisation_id: orgId }).session(session || null);
  const pay: any = await Payment.findOne({ _id: a.payment_id, organisation_id: orgId }).session(session || null);
  if (!line || !pay) throw notFound('Line or payment');
  line.allocated_minor += a.amount_minor;
  line.status = line.allocated_minor >= line.debit_minor ? 'matched' : 'partial'; line.exception = undefined; line.suggestion = undefined; await line.save({ session });
  pay.reconciled_minor += a.amount_minor;
  if (pay.reconciled_minor >= pay.net_minor - tol) pay.reconciled = true;
  let invoiceChanged = false;
  if (pay.status === 'released') { pay.status = 'paid'; pay.paid_via = 'bank_statement'; pay.paid_at = line.date; pay.bank_reference = line.reference || pay.bank_reference; pay.utr = line.reference || pay.utr; invoiceChanged = true; }
  await pay.save({ session });
  const inv: any = await Invoice.findOne({ _id: pay.invoice_id, organisation_id: orgId }).session(session || null);
  if (inv) {
    if (invoiceChanged && nextStatus(inv.status, 'paid')) inv.status = assertTransition(inv.status, 'paid');
    if (pay.reconciled && nextStatus(inv.status, 'reconcile')) {
      const others = await Payment.find({ organisation_id: orgId, invoice_id: inv._id, status: 'paid', reconciled: false, _id: { $ne: pay._id } }).session(session || null);
      if (!others.length) inv.status = assertTransition(inv.status, 'reconcile');
    }
    await inv.save({ session });
  }
}

async function reverseAllocation(orgId: string, alloc: any, actor: Actor, reason: string, session: any) {
  const line: any = await StatementLine.findOne({ _id: alloc.line_id, organisation_id: orgId }).session(session || null);
  const pay: any = await Payment.findOne({ _id: alloc.payment_id, organisation_id: orgId }).session(session || null);
  line.allocated_minor -= alloc.amount_minor; line.status = line.allocated_minor <= 0 ? 'unmatched' : 'partial'; await line.save({ session });
  pay.reconciled_minor -= alloc.amount_minor; pay.reconciled = false;
  const inv: any = await Invoice.findOne({ _id: pay.invoice_id, organisation_id: orgId }).session(session || null);
  if (pay.paid_via === 'bank_statement' && pay.reconciled_minor <= 0) { pay.status = 'released'; pay.paid_via = undefined; pay.paid_at = undefined; pay.bank_reference = null; pay.utr = null; if (inv && ['paid', 'reconciled'].includes(inv.status)) { inv.status = 'released'; await inv.save({ session }); } }
  else if (inv && inv.status === 'reconciled') { inv.status = 'paid'; await inv.save({ session }); }
  await pay.save({ session });
  alloc.state = 'reversed'; alloc.reversed_by = actor.userId; alloc.reversed_reason = reason; await alloc.save({ session });
}

// ---------------- matching job
export async function runMatching(orgId: string, userId: string | null, importId?: string) {
  const org: any = await Organisation.findById(orgId).lean();
  const cfg = { ...DEFAULT_MATCH_CONFIG, ...(org.settings?.recon || {}), classifiers: org.settings?.recon?.classifiers || [] };
  const lf: any = { organisation_id: orgId, status: { $in: ['unmatched', 'exception'] } };
  if (importId) lf.import_id = importId;
  const lines: any[] = await StatementLine.find(lf).lean();
  if (!lines.length) return { matched: 0, suggested: 0, exceptions: 0, classified: 0 };
  const pays: any[] = await Payment.find({ organisation_id: orgId, status: { $in: ['released', 'paid'] }, reconciled: false }).lean();
  const pending = await ReconAllocation.find({ organisation_id: orgId, state: 'pending_approval' }).lean();
  const pend = new Map<string, number>(); pending.forEach((p: any) => pend.set(String(p.payment_id), (pend.get(String(p.payment_id)) || 0) + p.amount_minor));
  const mpays: MPay[] = pays.map((p) => ({ id: String(p._id), reference: p.reference, utr: p.utr, net_minor: p.net_minor, reconciled_minor: p.reconciled_minor + (pend.get(String(p._id)) || 0),
    vendor_name: p.vendor_name || '', run_id: String(p.run_id), released_at: p.released_at || p.createdAt }));
  const mlines: MLine[] = lines.map((l) => ({ id: String(l._id), date: l.date, narration: l.narration || '', reference: l.reference, debit_minor: l.debit_minor, credit_minor: l.credit_minor }));
  const proposals = matchLines(mlines, mpays, cfg);
  const audit: AuditActor = { orgId, userId };
  const counts = { matched: 0, suggested: 0, exceptions: 0, classified: 0 };
  for (let i = 0; i < proposals.length; i += 40) {
    await withTxn(async (session) => {
      for (const p of proposals.slice(i, i + 40)) {
        if (p.kind === 'match') {
          for (const a of p.allocations) {
            await ReconAllocation.create([{ organisation_id: orgId, line_id: a.line_id, payment_id: a.payment_id, amount_minor: a.amount_minor, method: p.method, confidence: p.confidence, state: 'confirmed', source: 'system' }], { session });
            await applyAllocation(orgId, a, session, audit, cfg.tolerance_minor);
          }
          await writeAudit(audit, { action: 'recon.auto_matched', entity_type: 'StatementLine', entity_id: p.allocations[0].line_id, metadata: { method: p.method, confidence: p.confidence, payments: p.allocations.map((a) => a.payment_id) } }, session);
          counts.matched++;
        } else if (p.kind === 'suggestion') {
          await StatementLine.updateOne({ _id: p.allocations[0].line_id, organisation_id: orgId }, { $set: { status: 'suggested', suggestion: { allocations: p.allocations, method: p.method, confidence: p.confidence } } }, { session });
          counts.suggested++;
        } else if (p.kind === 'exception') {
          await StatementLine.updateOne({ _id: p.line_id, organisation_id: orgId }, { $set: { status: 'exception', exception: { reason: p.reason, candidates: p.candidates } } }, { session });
          counts.exceptions++;
        } else {
          await StatementLine.updateOne({ _id: p.line_id, organisation_id: orgId }, { $set: { status: 'classified', category: p.category } }, { session });
          counts.classified++;
        }
      }
    });
  }
  return counts;
}

// ---------------- human actions
export async function confirmSuggestion(actor: Actor, lineId: string) {
  const line: any = await StatementLine.findOne({ _id: lineId, organisation_id: actor.orgId });
  if (!line || line.status !== 'suggested' || !line.suggestion) throw conflict('This line has no suggestion to confirm.', 'INVALID_STATE');
  return withTxn(async (session) => {
    for (const a of line.suggestion.allocations) await ReconAllocation.create([{ organisation_id: actor.orgId, line_id: a.line_id, payment_id: a.payment_id, amount_minor: a.amount_minor, method: line.suggestion.method, confidence: line.suggestion.confidence, state: 'pending_approval', source: 'user', proposed_by: actor.userId }], { session });
    line.status = 'pending_approval'; line.suggestion = undefined; await line.save({ session });
    await writeAudit(actor, { action: 'recon.suggestion_confirmed', entity_type: 'StatementLine', entity_id: lineId }, session);
    return { id: lineId, status: 'pending_approval' };
  });
}
export async function rejectSuggestion(actor: Actor, lineId: string) {
  const r = await StatementLine.findOneAndUpdate({ _id: lineId, organisation_id: actor.orgId, status: 'suggested' }, { $set: { status: 'exception', exception: { reason: 'suggestion_rejected', candidates: [] }, suggestion: null } }, { returnDocument: 'after' });
  if (!r) throw conflict('This line has no suggestion.', 'INVALID_STATE');
  await withTxn((s) => writeAudit(actor, { action: 'recon.suggestion_rejected', entity_type: 'StatementLine', entity_id: lineId }, s));
  return { id: lineId, status: 'exception' };
}

export async function manualMatch(actor: Actor, lineId: string, allocations: { payment_id: string; amount_minor: number }[]) {
  const line: any = await StatementLine.findOne({ _id: lineId, organisation_id: actor.orgId });
  if (!line) throw notFound('Statement line');
  if (!(line.debit_minor > 0)) throw badRequest('Only debit lines can be matched to vendor payments.');
  if (!['unmatched', 'exception', 'suggested', 'partial'].includes(line.status)) throw conflict(`A line that is ${line.status} cannot be matched.`, 'INVALID_STATE');
  const remaining = line.debit_minor - line.allocated_minor;
  const total = allocations.reduce((a, x) => a + x.amount_minor, 0);
  if (total <= 0 || total > remaining) throw badRequest(`Allocated amount (${total}) must be positive and not exceed the unmatched amount of the line (${remaining}).`);
  const pend = await ReconAllocation.find({ organisation_id: actor.orgId, state: 'pending_approval' }).lean();
  for (const a of allocations) {
    const pay: any = await Payment.findOne({ _id: a.payment_id, organisation_id: actor.orgId }).lean();
    if (!pay || !['released', 'paid'].includes(pay.status)) throw badRequest('Payments must be released or paid to be matched.');
    const outstanding = pay.net_minor - pay.reconciled_minor - pend.filter((p: any) => String(p.payment_id) === a.payment_id).reduce((s: number, p: any) => s + p.amount_minor, 0);
    if (a.amount_minor <= 0 || a.amount_minor > outstanding) throw badRequest(`Payment ${pay.reference} has only ${outstanding} paise left to match.`);
  }
  return withTxn(async (session) => {
    for (const a of allocations) await ReconAllocation.create([{ organisation_id: actor.orgId, line_id: lineId, payment_id: a.payment_id, amount_minor: a.amount_minor, method: 'manual', confidence: 1, state: 'pending_approval', source: 'user', proposed_by: actor.userId }], { session });
    line.status = 'pending_approval'; line.exception = undefined; await line.save({ session });
    await writeAudit(actor, { action: 'recon.manual_match_proposed', entity_type: 'StatementLine', entity_id: lineId, new_values: { allocations } }, session);
    return { id: lineId, status: 'pending_approval' };
  });
}

export async function decideMatch(actor: Actor, lineId: string, decision: 'approve' | 'reject', note?: string) {
  const line: any = await StatementLine.findOne({ _id: lineId, organisation_id: actor.orgId });
  if (!line || line.status !== 'pending_approval') throw conflict('This line is not waiting for approval.', 'INVALID_STATE');
  const allocs: any[] = await ReconAllocation.find({ organisation_id: actor.orgId, line_id: lineId, state: 'pending_approval' });
  const imp: any = await StatementImport.findOne({ _id: line.import_id, organisation_id: actor.orgId }).lean();
  const sod = await getSod(actor.orgId);
  for (const a of allocs) { const v = checkMatchApproval(sod, actor.userId, { proposedBy: a.proposed_by, importedBy: imp?.uploaded_by }); if (v) throw forbidden(v.message, 'SOD_VIOLATION', { rule: v.rule }); }
  if (decision === 'reject' && !note) throw badRequest('A reason is required to reject a match.');
  const org: any = await Organisation.findById(actor.orgId).lean();
  return withTxn(async (session) => {
    for (const a of allocs) {
      if (decision === 'approve') { a.state = 'confirmed'; a.approved_by = actor.userId; a.approved_at = new Date(); await a.save({ session }); await applyAllocation(actor.orgId, a, session, actor, org.settings?.recon?.tolerance_minor || 0); }
      else { a.state = 'rejected'; a.reversed_reason = note; await a.save({ session }); }
    }
    if (decision === 'reject') { line.status = 'exception'; line.exception = { reason: 'match_rejected', candidates: [] }; await line.save({ session }); }
    await writeAudit(actor, { action: `recon.match_${decision}d`, entity_type: 'StatementLine', entity_id: lineId, metadata: { note } }, session);
    return { id: lineId, decision };
  });
}

export async function unmatch(actor: Actor, lineId: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw badRequest('A reason of at least 5 characters is required.');
  const allocs: any[] = await ReconAllocation.find({ organisation_id: actor.orgId, line_id: lineId, state: 'confirmed' });
  if (!allocs.length) throw conflict('This line has no confirmed matches.', 'INVALID_STATE');
  return withTxn(async (session) => {
    for (const a of allocs) await reverseAllocation(actor.orgId, a, actor, reason, session);
    await writeAudit(actor, { action: 'recon.unmatched', entity_type: 'StatementLine', entity_id: lineId, metadata: { reason, allocations: allocs.map((a) => ({ payment_id: a.payment_id, amount_minor: a.amount_minor })) } }, session);
    return { id: lineId, status: 'unmatched' };
  });
}

export async function classifyLine(actor: Actor, lineId: string, category: string | null, ignore = false) {
  const line: any = await StatementLine.findOne({ _id: lineId, organisation_id: actor.orgId });
  if (!line) throw notFound('Statement line');
  if (!['unmatched', 'exception', 'suggested', 'ignored'].includes(line.status)) throw conflict(`A line that is ${line.status} cannot be classified.`, 'INVALID_STATE');
  return withTxn(async (session) => {
    line.status = ignore ? 'ignored' : 'classified'; line.category = category; line.classified_by = actor.userId; line.suggestion = undefined; await line.save({ session });
    await writeAudit(actor, { action: 'recon.classified', entity_type: 'StatementLine', entity_id: lineId, metadata: { category, ignore } }, session);
    return { id: lineId, status: line.status, category };
  });
}

// ---------------- reads
export async function listLines(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId };
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.bank_account_id) f.bank_account_id = String(req.query.bank_account_id);
  if (req.query.import_id) f.import_id = String(req.query.import_id);
  if (req.query.direction === 'debit') f.debit_minor = { $gt: 0 }; if (req.query.direction === 'credit') f.credit_minor = { $gt: 0 };
  if (req.query.q) f.narration = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (req.query.from || req.query.to) f.date = { ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}) };
  const page = await paginate(StatementLine.find(f).sort({ date: -1, row_number: 1 }), StatementLine.countDocuments(f), req);
  const ids = page.data.map((l: any) => l._id);
  const allocs: any[] = await ReconAllocation.find({ organisation_id: actor.orgId, line_id: { $in: ids }, state: { $in: ['confirmed', 'pending_approval'] } }).lean();
  const pays = new Map((await Payment.find({ organisation_id: actor.orgId, _id: { $in: allocs.map((a) => a.payment_id) } }).lean()).map((p: any) => [String(p._id), p]));
  return { ...page, data: page.data.map((l: any) => ({ id: String(l._id), date: l.date, narration: l.narration, reference: l.reference, debit_minor: l.debit_minor, credit_minor: l.credit_minor, balance_minor: l.balance_minor,
    status: l.status, allocated_minor: l.allocated_minor, exception: l.exception, suggestion: l.suggestion, category: l.category, import_id: String(l.import_id),
    matches: allocs.filter((a) => String(a.line_id) === String(l._id)).map((a) => ({ allocation_id: String(a._id), payment_id: String(a.payment_id), payment_reference: pays.get(String(a.payment_id))?.reference, vendor_name: pays.get(String(a.payment_id))?.vendor_name,
      amount_minor: a.amount_minor, method: a.method, confidence: a.confidence, state: a.state })) })) };
}

/** Payments a person can pick when matching a line by hand. */
export async function candidatePayments(actor: Actor) {
  const pays: any[] = await Payment.find({ organisation_id: actor.orgId, status: { $in: ['released', 'paid'] }, reconciled: false }).sort({ released_at: -1 }).limit(300).lean();
  const pend = await ReconAllocation.find({ organisation_id: actor.orgId, state: 'pending_approval' }).lean();
  return pays.map((p) => ({ id: String(p._id), reference: p.reference, vendor_name: p.vendor_name, invoice_number: p.invoice_number, net_minor: p.net_minor, status: p.status, released_at: p.released_at,
    outstanding_minor: p.net_minor - p.reconciled_minor - pend.filter((x: any) => String(x.payment_id) === String(p._id)).reduce((s: number, x: any) => s + x.amount_minor, 0) }));
}

export async function reconSummary(actor: Actor) {
  const org = new mongoose.Types.ObjectId(actor.orgId);
  const byStatus: any[] = await StatementLine.aggregate([{ $match: { organisation_id: org } }, { $group: { _id: '$status', n: { $sum: 1 }, debit: { $sum: '$debit_minor' } } }]);
  const unreconciledPayments = await Payment.countDocuments({ organisation_id: actor.orgId, status: { $in: ['released', 'paid'] }, reconciled: false });
  return { lines: Object.fromEntries(byStatus.map((s) => [s._id, { count: s.n, debit_minor: s.debit }])), unreconciled_payments: unreconciledPayments };
}
