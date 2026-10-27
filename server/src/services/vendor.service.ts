import { Request } from 'express';
import { Vendor, VendorChange, Invoice } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { encryptSecret, decryptSecret, last4, maskAccount } from '../lib/crypto';
import { validateGstin, isValidPan, isValidIfsc } from '../lib/validators';
import { checkProposerApproval } from '../domain/policy';
import { getSod } from './org.service';
import { paginate } from '../lib/paginate';
import { notifyMany } from './notification.service';
import { User, Role } from '../models';

export const vendorDto = (v: any) => ({
  id: String(v._id), name: v.name, gstin: v.gstin, pan: v.pan, category: v.category, payment_terms_days: v.payment_terms_days, tds_section: v.tds_section,
  status: v.status, contact_name: v.contact_name, contact_email: v.contact_email, contact_phone: v.contact_phone, address: v.address,
  bank: v.bank ? { account_name: v.bank.account_name, account_masked: maskAccount(v.bank.account_last4), ifsc: v.bank.ifsc, bank_name: v.bank.bank_name } : null,
  proposed_by: v.proposed_by ? String(v.proposed_by) : null, approved_at: v.approved_at, createdAt: v.createdAt, rejection_reason: v.rejection_reason || null,
});

function bankFromInput(b: any) {
  if (!b) return null;
  if (!isValidIfsc(b.ifsc)) throw badRequest('IFSC code is not valid (4 letters, 0, then 6 letters or digits).');
  const acct = String(b.account_number || '').replace(/\s/g, '');
  if (!/^\d{6,20}$/.test(acct)) throw badRequest('Account number must be 6 to 20 digits.');
  return { account_name: b.account_name, account_number_enc: encryptSecret(acct), account_last4: last4(acct), ifsc: b.ifsc.toUpperCase(), bank_name: b.bank_name || null };
}
function checkIds(gstin?: string | null, pan?: string | null) {
  if (gstin) { const g = validateGstin(gstin); if (!g.structure || !g.stateCode) throw badRequest('GSTIN is not valid.'); if (!g.checksum) throw badRequest('GSTIN check digit is wrong. Please re-check the number.'); }
  if (pan && !isValidPan(pan)) throw badRequest('PAN is not valid.');
}

export async function listVendors(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId };
  if (req.query.status) f.status = String(req.query.status);
  if (req.query.q) f.name = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const page = await paginate(Vendor.find(f).sort({ name: 1 }), Vendor.countDocuments(f), req);
  // Counts per status for the filter chips; they ignore the current filter so the chips stay stable.
  const grouped: any[] = await Vendor.aggregate([{ $match: { organisation_id: (Vendor.schema.path('organisation_id') as any).cast(actor.orgId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const counts: Record<string, number> = { active: 0, pending_approval: 0, inactive: 0, rejected: 0 };
  for (const g of grouped) counts[g._id] = g.n;
  return { ...page, data: page.data.map(vendorDto), counts };
}
export async function getVendor(actor: Actor, id: string) {
  const v = await Vendor.findOne({ _id: id, organisation_id: actor.orgId }).lean(); if (!v) throw notFound('Vendor');
  return { ...vendorDto(v), stats: await vendorStats(actor.orgId, id) };
}

const OPEN_STATUSES = ['in_review', 'on_hold', 'approved', 'scheduled', 'released'];
/** Invoice totals for one vendor: how many, how much is still payable, how much is paid. */
async function vendorStats(orgId: string, vendorId: string) {
  const rows: any[] = await Invoice.aggregate([
    { $match: { organisation_id: (Invoice.schema.path('organisation_id') as any).cast(orgId), vendor_id: (Invoice.schema.path('vendor_id') as any).cast(vendorId) } },
    { $group: { _id: null, invoice_count: { $sum: 1 }, last_invoice_date: { $max: '$invoice_date' },
      open_minor: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, '$net_payable_minor', 0] } },
      paid_minor: { $sum: { $cond: [{ $in: ['$status', ['paid', 'reconciled']] }, '$net_payable_minor', 0] } } } }]);
  const r = rows[0];
  return { invoice_count: r?.invoice_count ?? 0, open_minor: r?.open_minor ?? 0, paid_minor: r?.paid_minor ?? 0, last_invoice_date: r?.last_invoice_date ?? null };
}

async function approvers(orgId: string, perm: string) {
  const roles = (await Role.find({ organisation_id: orgId, permissions: perm }).lean()).map((r: any) => r._id);
  return (await User.find({ organisation_id: orgId, is_active: true, role_id: { $in: roles } }).lean()).map((u: any) => u._id);
}

export async function proposeVendor(actor: Actor, input: any) {
  checkIds(input.gstin, input.pan);
  const bank = bankFromInput(input.bank);
  return withTxn(async (session) => {
    const [v]: any = await Vendor.create([{ organisation_id: actor.orgId, name: input.name, gstin: input.gstin || null, pan: input.pan || (input.gstin ? validateGstin(input.gstin).pan : null),
      category: input.category || null, payment_terms_days: input.payment_terms_days ?? 30, tds_section: input.tds_section || null, contact_name: input.contact_name, contact_email: input.contact_email,
      contact_phone: input.contact_phone, address: input.address, bank, status: 'pending_approval', proposed_by: actor.userId }], { session });
    await writeAudit(actor, { action: 'vendor.proposed', entity_type: 'Vendor', entity_id: v._id, new_values: { name: v.name, gstin: v.gstin, ifsc: bank?.ifsc, account_last4: bank?.account_last4 } }, session);
    await notifyMany(actor.orgId, await approvers(actor.orgId, 'vendor.approve'), { kind: 'vendor.pending', title: 'New vendor needs approval', body: `${v.name} was proposed by ${actor.name}.`, entity_type: 'Vendor', entity_id: v._id }, session);
    return vendorDto(v);
  });
}

export async function decideVendor(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string) {
  const v: any = await Vendor.findOne({ _id: id, organisation_id: actor.orgId });
  if (!v) throw notFound('Vendor');
  if (v.status !== 'pending_approval') throw conflict(`Vendor is already ${v.status}.`, 'ALREADY_DECIDED');
  const viol = checkProposerApproval(await getSod(actor.orgId), actor.userId, v.proposed_by);
  if (viol) throw forbidden(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
  if (decision === 'reject' && !note) throw badRequest('A reason is required to reject a vendor.');
  return withTxn(async (session) => {
    v.status = decision === 'approve' ? 'active' : 'rejected'; v.approved_by = actor.userId; v.approved_at = new Date(); v.rejection_reason = decision === 'reject' ? note : undefined;
    await v.save({ session });
    await writeAudit(actor, { action: `vendor.${decision}d`, entity_type: 'Vendor', entity_id: id, metadata: { note } }, session);
    return vendorDto(v);
  });
}

/** Contact details can be edited by proposers; identity, tax and terms changes need vendor.approve. */
export async function updateVendor(actor: Actor, id: string, patch: any) {
  const v: any = await Vendor.findOne({ _id: id, organisation_id: actor.orgId }); if (!v) throw notFound('Vendor');
  const sensitive = ['name', 'gstin', 'pan', 'category', 'payment_terms_days', 'tds_section', 'status'].filter((k) => patch[k] !== undefined);
  if (sensitive.length && !actor.permissions.has('vendor.approve')) throw forbidden(`Changing ${sensitive.join(', ')} needs the vendor.approve permission.`, 'MISSING_PERMISSION');
  checkIds(patch.gstin, patch.pan);
  // Only an approved vendor can be switched between active and inactive. Pending and rejected vendors go through approve/reject.
  if (patch.status !== undefined && patch.status !== v.status) {
    if (!['active', 'inactive'].includes(v.status)) throw conflict(`A vendor that is ${v.status.replace('_', ' ')} cannot be made ${patch.status}. Use approve or reject.`, 'BAD_STATE');
  }
  if (patch.status === 'inactive' && v.status === 'active') {
    const open = await Invoice.countDocuments({ organisation_id: actor.orgId, vendor_id: id, status: { $in: ['approved', 'scheduled', 'released'] } });
    if (open > 0) throw conflict(`${open} approved or scheduled invoice(s) still need payment. Pay or return them before deactivating this vendor.`, 'OPEN_INVOICES');
  }
  const before: any = {}; const next: any = {};
  for (const k of ['contact_name', 'contact_email', 'contact_phone', 'address', ...sensitive]) if (patch[k] !== undefined) { before[k] = v[k]; v[k] = patch[k]; next[k] = patch[k]; }
  return withTxn(async (session) => { await v.save({ session }); await writeAudit(actor, { action: 'vendor.updated', entity_type: 'Vendor', entity_id: id, old_values: before, new_values: next }, session); return vendorDto(v); });
}

// ---- bank detail changes: a second person must approve
export async function proposeBankChange(actor: Actor, id: string, input: any) {
  const v: any = await Vendor.findOne({ _id: id, organisation_id: actor.orgId }); if (!v) throw notFound('Vendor');
  if (await VendorChange.findOne({ organisation_id: actor.orgId, vendor_id: id, status: 'pending' }).lean()) throw conflict('A bank change is already waiting for approval.', 'PENDING_EXISTS');
  const bank = bankFromInput(input.bank);
  return withTxn(async (session) => {
    const [c]: any = await VendorChange.create([{ organisation_id: actor.orgId, vendor_id: id, bank, reason: input.reason, proposed_by: actor.userId }], { session });
    await writeAudit(actor, { action: 'vendor.bank_change_proposed', entity_type: 'Vendor', entity_id: id, old_values: { account_last4: v.bank?.account_last4, ifsc: v.bank?.ifsc }, new_values: { account_last4: bank!.account_last4, ifsc: bank!.ifsc }, metadata: { reason: input.reason } }, session);
    await notifyMany(actor.orgId, await approvers(actor.orgId, 'vendor.bank_change.approve'), { kind: 'vendor.bank_change', title: 'Vendor bank change needs approval', body: `${v.name}: new account ending ${bank!.account_last4}.`, entity_type: 'Vendor', entity_id: id }, session);
    return { id: String(c._id), status: c.status };
  });
}
export async function listBankChanges(actor: Actor) {
  const rows: any[] = await VendorChange.find({ organisation_id: actor.orgId, status: 'pending' }).sort({ createdAt: -1 }).lean();
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: rows.map((r) => r.vendor_id) } }).lean()).map((v: any) => [String(v._id), v]));
  return rows.map((r) => ({ id: String(r._id), vendor_id: String(r.vendor_id), vendor_name: vendors.get(String(r.vendor_id))?.name, current: vendors.get(String(r.vendor_id))?.bank ? { account_masked: maskAccount(vendors.get(String(r.vendor_id)).bank.account_last4), ifsc: vendors.get(String(r.vendor_id)).bank.ifsc } : null,
    proposed: { account_masked: maskAccount(r.bank.account_last4), ifsc: r.bank.ifsc, account_name: r.bank.account_name }, reason: r.reason, proposed_by: String(r.proposed_by), createdAt: r.createdAt }));
}
export async function decideBankChange(actor: Actor, changeId: string, decision: 'approve' | 'reject', note?: string) {
  const c: any = await VendorChange.findOne({ _id: changeId, organisation_id: actor.orgId }); if (!c) throw notFound('Bank change');
  if (c.status !== 'pending') throw conflict(`Already ${c.status}.`, 'ALREADY_DECIDED');
  const viol = checkProposerApproval(await getSod(actor.orgId), actor.userId, c.proposed_by);
  if (viol) throw forbidden(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
  return withTxn(async (session) => {
    c.status = decision === 'approve' ? 'approved' : 'rejected'; c.decided_by = actor.userId; c.decided_at = new Date(); c.decision_note = note; await c.save({ session });
    if (decision === 'approve') await Vendor.updateOne({ _id: c.vendor_id, organisation_id: actor.orgId }, { $set: { bank: c.bank } }, { session });
    await writeAudit(actor, { action: `vendor.bank_change_${decision}d`, entity_type: 'Vendor', entity_id: c.vendor_id, metadata: { change_id: changeId, note } }, session);
    return { id: changeId, status: c.status };
  });
}

/** Full account number: only with vendor.bank_reveal, and every reveal is audited. */
export async function revealBank(actor: Actor, id: string) {
  const v: any = await Vendor.findOne({ _id: id, organisation_id: actor.orgId }).lean();
  if (!v?.bank?.account_number_enc) throw notFound('Bank details');
  await withTxn((s) => writeAudit(actor, { action: 'vendor.bank_revealed', entity_type: 'Vendor', entity_id: id }, s));
  return { account_name: v.bank.account_name, account_number: decryptSecret(v.bank.account_number_enc), ifsc: v.bank.ifsc, bank_name: v.bank.bank_name };
}

/** Minimal vendor picker data for people who create invoices but may not browse the vendor master. */
export async function listOptions(actor: Actor) {
  const rows: any[] = await Vendor.find({ organisation_id: actor.orgId, status: { $in: ['active', 'pending_approval'] } }).sort({ name: 1 }).limit(1000).lean();
  return rows.map((v) => ({ id: String(v._id), name: v.name, status: v.status, gstin: v.gstin, tds_section: v.tds_section, category: v.category }));
}
