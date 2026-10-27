import { Request } from 'express';
import { Invoice, Vendor, ApprovalStep, Organisation, InvoiceComment, User } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { normaliseInvoiceNumber } from '../lib/validators';
import { checkTotals, computeTds } from '../domain/tax';
import { assertTransition } from '../domain/stateMachine';
import { paginate } from '../lib/paginate';
import { storage } from './storage';

export interface InvoiceInput {
  number: string; vendor_id: string; invoice_date: Date; due_date: Date; currency?: string;
  subtotal_minor: number; cgst_minor?: number; sgst_minor?: number; igst_minor?: number; cess_minor?: number; round_off_minor?: number; total_minor: number;
  department?: string | null; cost_centre?: string | null; description?: string;
  line_items?: { description: string; amount_minor: number; gl_code?: string; quantity?: number; hsn?: string }[];
  file?: any; intake_id?: string; duplicate_override_reason?: string;
}

export const invoiceDto = (i: any) => ({
  id: String(i._id), number: i.number, vendor_id: String(i.vendor_id), status: i.status, currency: i.currency,
  subtotal_minor: i.subtotal_minor, cgst_minor: i.cgst_minor, sgst_minor: i.sgst_minor, igst_minor: i.igst_minor, cess_minor: i.cess_minor, round_off_minor: i.round_off_minor, total_minor: i.total_minor,
  tds_section: i.tds_section, tds_rate_bps: i.tds_rate_bps, tds_minor: i.tds_minor, net_payable_minor: i.net_payable_minor,
  invoice_date: i.invoice_date, due_date: i.due_date, department: i.department, cost_centre: i.cost_centre, description: i.description,
  line_items: i.line_items, has_file: !!i.file?.key, file_name: i.file?.name, rule_name: i.rule_name, approval_mode: i.approval_mode,
  created_by: String(i.created_by), hold: i.hold?.reason ? i.hold : null, rejection: i.rejection?.reason ? i.rejection : null,
  duplicate_override: i.duplicate_override?.reason ? { reason: i.duplicate_override.reason } : null,
  submitted_at: i.submitted_at, approved_at: i.approved_at, createdAt: i.createdAt, updatedAt: i.updatedAt,
});

/** Which invoices this user may see: all, only assigned ones, or only their own. */
export async function visibilityFilter(actor: Actor): Promise<any | null> {
  if (actor.permissions.has('invoice.view_all')) return {};
  const or: any[] = [];
  if (actor.permissions.has('invoice.view_own') || actor.permissions.has('invoice.create_own') || actor.permissions.has('invoice.create')) or.push({ created_by: actor.userId });
  if (actor.permissions.has('invoice.view_assigned')) {
    const ids = await ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, $or: [{ approver_id: actor.userId }, { acted_by: actor.userId }] });
    or.push({ _id: { $in: ids } });
  }
  return or.length ? { $or: or } : null;
}
export async function loadVisible(actor: Actor, id: string) {
  const vis = await visibilityFilter(actor);
  if (vis === null) throw forbidden('You cannot view invoices.');
  const inv: any = await Invoice.findOne({ _id: id, organisation_id: actor.orgId, ...vis });
  if (!inv) throw notFound('Invoice');
  return inv;
}

async function priceInvoice(orgId: string, vendor: any, input: Partial<InvoiceInput>) {
  const t = { subtotal_minor: input.subtotal_minor!, cgst_minor: input.cgst_minor || 0, sgst_minor: input.sgst_minor || 0, igst_minor: input.igst_minor || 0, cess_minor: input.cess_minor || 0, round_off_minor: input.round_off_minor || 0, total_minor: input.total_minor! };
  for (const [k, v] of Object.entries(t)) if (!Number.isSafeInteger(v)) throw badRequest(`${k} must be a whole number of paise.`);
  if (t.subtotal_minor <= 0 || t.total_minor <= 0) throw badRequest('Amounts must be greater than zero.');
  const chk = checkTotals(t);
  if (!chk.ok) throw badRequest(`Taxable value plus taxes and round-off is ${chk.expected_minor} paise but the total is ${t.total_minor} paise.`, { expected_minor: chk.expected_minor }, 'TOTAL_MISMATCH');
  if (input.line_items?.length) {
    const sum = input.line_items.reduce((a, l) => a + l.amount_minor, 0);
    if (sum !== t.subtotal_minor) throw badRequest(`Line items add up to ${sum} paise but the taxable value is ${t.subtotal_minor} paise.`, undefined, 'LINES_MISMATCH');
  }
  const org: any = await Organisation.findById(orgId).lean();
  let tds: any = { section: null, rate_bps: 0, amount_minor: 0 };
  try { tds = computeTds(t.subtotal_minor, vendor.tds_section, org.settings?.tax?.tds_sections || []); } catch (e: any) { throw badRequest(e.message, undefined, 'TDS_NOT_CONFIGURED'); }
  return { ...t, tds_section: tds.section, tds_rate_bps: tds.rate_bps, tds_minor: tds.amount_minor, net_payable_minor: t.total_minor - tds.amount_minor };
}

async function checkDuplicates(orgId: string, vendorId: string, norm: string, total: number, invoiceDate: Date, fileHash: string | undefined, override: string | undefined, ignoreId?: string) {
  const notSelf: any = ignoreId ? { _id: { $ne: ignoreId } } : {};
  const same = await Invoice.findOne({ organisation_id: orgId, vendor_id: vendorId, number_norm: norm, ...notSelf }).lean();
  if (same) throw conflict(`This vendor already has invoice ${(same as any).number}. The same vendor and invoice number cannot be entered twice.`, 'DUPLICATE_INVOICE_NUMBER', { invoice_id: String((same as any)._id) });
  if (fileHash) {
    const f = await Invoice.findOne({ organisation_id: orgId, 'file.hash': fileHash, ...notSelf }).lean();
    if (f) throw conflict('This exact file is already attached to another invoice.', 'DUPLICATE_FILE', { invoice_id: String((f as any)._id) });
  }
  const win = 30 * 86400000;
  const similar: any = await Invoice.findOne({ organisation_id: orgId, vendor_id: vendorId, total_minor: total, invoice_date: { $gte: new Date(invoiceDate.getTime() - win), $lte: new Date(invoiceDate.getTime() + win) }, ...notSelf }).lean();
  if (similar) {
    if (!override || override.trim().length < 10) throw conflict(`Possible duplicate: invoice ${similar.number} has the same vendor and amount within 30 days. Provide a reason (at least 10 characters) to continue.`, 'POSSIBLE_DUPLICATE', { similar_invoice_id: String(similar._id), similar_number: similar.number });
    return { reason: override.trim(), similar_invoice_id: similar._id };
  }
  return null;
}

export async function createInvoice(actor: Actor, input: InvoiceInput, session?: any) {
  if (!actor.permissions.has('invoice.create') && !actor.permissions.has('invoice.create_own')) throw forbidden('You cannot create invoices.', 'MISSING_PERMISSION');
  const vendor: any = await Vendor.findOne({ _id: input.vendor_id, organisation_id: actor.orgId }).lean();
  if (!vendor) throw badRequest('Vendor not found.');
  if (!['active', 'pending_approval'].includes(vendor.status)) throw badRequest(`Vendor is ${vendor.status}.`);
  const priced = await priceInvoice(actor.orgId, vendor, input);
  const norm = normaliseInvoiceNumber(input.number);
  if (!norm) throw badRequest('Invoice number is required.');
  if (input.due_date < input.invoice_date) throw badRequest('Due date cannot be before the invoice date.');
  const dup = await checkDuplicates(actor.orgId, input.vendor_id, norm, input.total_minor, input.invoice_date, input.file?.hash, input.duplicate_override_reason);
  const run = async (s: any) => {
    const [inv]: any = await Invoice.create([{ organisation_id: actor.orgId, number: input.number.trim(), number_norm: norm, vendor_id: input.vendor_id, created_by: actor.userId, status: 'draft',
      currency: input.currency || 'INR', ...priced, invoice_date: input.invoice_date, due_date: input.due_date, department: input.department || null, cost_centre: input.cost_centre || null,
      description: input.description || '', line_items: input.line_items || [], file: input.file || null, intake_id: input.intake_id, duplicate_override: dup || undefined }], { session: s });
    await writeAudit(actor, { action: 'invoice.created', entity_type: 'Invoice', entity_id: inv._id, new_values: { number: inv.number, vendor_id: inv.vendor_id, total_minor: inv.total_minor }, metadata: dup ? { duplicate_override: dup.reason } : undefined }, s);
    return inv;
  };
  return session ? run(session) : withTxn(run);
}

export async function updateInvoice(actor: Actor, id: string, patch: Partial<InvoiceInput>) {
  const inv: any = await loadVisible(actor, id);
  const mine = String(inv.created_by) === actor.userId;
  if (!actor.permissions.has('invoice.edit_before_approval') && !(mine && actor.permissions.has('invoice.create_own'))) throw forbidden('You cannot edit this invoice.', 'MISSING_PERMISSION');
  if (!['draft', 'on_hold'].includes(inv.status)) throw conflict(`An invoice that is ${inv.status} cannot be edited.`, 'NOT_EDITABLE');
  const vendor: any = await Vendor.findOne({ _id: patch.vendor_id || inv.vendor_id, organisation_id: actor.orgId }).lean();
  if (!vendor) throw badRequest('Vendor not found.');
  const merged: any = { ...inv.toObject(), ...patch };
  const priced = await priceInvoice(actor.orgId, vendor, merged);
  const number = (patch.number ?? inv.number).trim(); const norm = normaliseInvoiceNumber(number);
  if (merged.due_date < merged.invoice_date) throw badRequest('Due date cannot be before the invoice date.');
  const dup = await checkDuplicates(actor.orgId, String(vendor._id), norm, merged.total_minor, merged.invoice_date, inv.file?.hash, patch.duplicate_override_reason || inv.duplicate_override?.reason, id);
  const before = invoiceDto(inv);
  return withTxn(async (session) => {
    Object.assign(inv, { number, number_norm: norm, vendor_id: vendor._id, ...priced, invoice_date: merged.invoice_date, due_date: merged.due_date, department: merged.department ?? null, cost_centre: merged.cost_centre ?? null, description: merged.description ?? '', line_items: merged.line_items || [] });
    if (dup) inv.duplicate_override = dup;
    if (!inv.edited_by.map(String).includes(actor.userId) && mine === false) inv.edited_by.push(actor.userId);
    if (mine === false && !inv.edited_by.map(String).includes(actor.userId)) inv.edited_by.push(actor.userId);
    // Editing an invoice that was on hold invalidates its approvals: it goes back to draft and must be resubmitted.
    if (inv.status === 'on_hold') {
      await ApprovalStep.updateMany({ organisation_id: actor.orgId, invoice_id: id, status: 'pending' }, { $set: { status: 'cancelled' } }, { session });
      inv.status = 'draft'; inv.hold = undefined;
    }
    await inv.save({ session });
    await writeAudit(actor, { action: 'invoice.updated', entity_type: 'Invoice', entity_id: id, old_values: before, new_values: invoiceDto(inv) }, session);
    return invoiceDto(inv);
  });
}

export async function listInvoices(actor: Actor, req: Request) {
  const vis = await visibilityFilter(actor);
  if (vis === null) throw forbidden('You cannot view invoices.');
  const f: any = { organisation_id: actor.orgId, ...vis };
  const q = req.query;
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.vendor_id) f.vendor_id = String(q.vendor_id);
  if (q.department) f.department = String(q.department);
  if (q.q) f.number = { $regex: String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (q.due_from || q.due_to) f.due_date = { ...(q.due_from ? { $gte: new Date(String(q.due_from)) } : {}), ...(q.due_to ? { $lte: new Date(String(q.due_to)) } : {}) };
  const page = await paginate(Invoice.find(f).sort({ createdAt: -1 }), Invoice.countDocuments(f), req);
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: page.data.map((i: any) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v.name]));
  return { ...page, data: page.data.map((i: any) => ({ ...invoiceDto(i), vendor_name: vendors.get(String(i.vendor_id)) })) };
}

export async function getInvoiceDetail(actor: Actor, id: string) {
  const inv: any = await loadVisible(actor, id);
  const vendor: any = await Vendor.findOne({ _id: inv.vendor_id, organisation_id: actor.orgId }).lean();
  const steps: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id }).sort({ round: 1, step_order: 1 }).lean();
  const users = new Map((await User.find({ organisation_id: actor.orgId, _id: { $in: [...steps.map((s) => s.approver_id), ...steps.map((s) => s.acted_by).filter(Boolean), inv.created_by] } }).lean()).map((u: any) => [String(u._id), u.full_name]));
  const comments: any[] = await InvoiceComment.find({ organisation_id: actor.orgId, invoice_id: id }).sort({ createdAt: 1 }).lean();
  const cu = new Map((await User.find({ organisation_id: actor.orgId, _id: { $in: comments.map((c) => c.author_id) } }).lean()).map((u: any) => [String(u._id), u.full_name]));
  return {
    ...invoiceDto(inv), vendor_name: vendor?.name, vendor_gstin: vendor?.gstin, created_by_name: users.get(String(inv.created_by)),
    approval_steps: steps.map((s) => ({ id: String(s._id), step_order: s.step_order, round: s.round, status: s.status, approver_id: String(s.approver_id), approver_name: users.get(String(s.approver_id)),
      acted_by_name: s.acted_by ? users.get(String(s.acted_by)) : null, comment: s.comment, decided_at: s.decided_at, activated_at: s.activated_at, escalated_at: s.escalated_at })),
    comments: comments.map((c) => ({ id: String(c._id), kind: c.kind, body: c.body, author_name: cu.get(String(c.author_id)), createdAt: c.createdAt })),
  };
}

export async function addComment(actor: Actor, id: string, body: string, kind: 'comment' | 'query' | 'response' = 'comment') {
  const inv: any = await loadVisible(actor, id);
  if (!actor.permissions.has('invoice.comment')) throw forbidden('You cannot comment on invoices.', 'MISSING_PERMISSION');
  return withTxn(async (s) => {
    const [c]: any = await InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind, body }], { session: s });
    await writeAudit(actor, { action: 'invoice.commented', entity_type: 'Invoice', entity_id: id, metadata: { kind } }, s);
    return { id: String(c._id), kind, body };
  });
}

export async function downloadInvoiceFile(actor: Actor, id: string) {
  const inv: any = await loadVisible(actor, id);
  if (!inv.file?.key) throw notFound('Document');
  const buf = await storage().read(inv.file.key);
  await withTxn((s) => writeAudit(actor, { action: 'invoice.file_downloaded', entity_type: 'Invoice', entity_id: id }, s));
  return { buffer: buf, mime: inv.file.mime, name: inv.file.name };
}
export async function attachFile(actor: Actor, id: string, file: { buffer: Buffer; name: string; mime: string }) {
  const inv: any = await loadVisible(actor, id);
  const mine = String(inv.created_by) === actor.userId;
  if (!actor.permissions.has('invoice.upload') && !(mine && actor.permissions.has('invoice.create_own'))) throw forbidden('You cannot upload documents.', 'MISSING_PERMISSION');
  if (!['draft', 'on_hold'].includes(inv.status)) throw conflict('Documents can only be attached while the invoice is draft or on hold.', 'NOT_EDITABLE');
  const saved = await storage().save(file.buffer, file.name, file.mime, `${actor.orgId}/invoices`);
  const dupe = await Invoice.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash, _id: { $ne: id } }).lean();
  if (dupe) { await storage().remove(saved.key); throw conflict('This exact file is already attached to another invoice.', 'DUPLICATE_FILE'); }
  return withTxn(async (s) => {
    inv.file = { key: saved.key, name: saved.originalName, size: saved.fileSize, hash: saved.fileHash, mime: saved.mimeType };
    await inv.save({ session: s });
    await writeAudit(actor, { action: 'invoice.file_attached', entity_type: 'Invoice', entity_id: id, new_values: { hash: saved.fileHash, size: saved.fileSize } }, s);
    return invoiceDto(inv);
  });
}
export { assertTransition };
