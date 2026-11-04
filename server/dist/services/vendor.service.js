"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vendorDto = void 0;
exports.listVendors = listVendors;
exports.getVendor = getVendor;
exports.proposeVendor = proposeVendor;
exports.decideVendor = decideVendor;
exports.updateVendor = updateVendor;
exports.proposeBankChange = proposeBankChange;
exports.listBankChanges = listBankChanges;
exports.decideBankChange = decideBankChange;
exports.revealBank = revealBank;
exports.listOptions = listOptions;
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const crypto_1 = require("../lib/crypto");
const validators_1 = require("../lib/validators");
const policy_1 = require("../domain/policy");
const org_service_1 = require("./org.service");
const paginate_1 = require("../lib/paginate");
const notification_service_1 = require("./notification.service");
const models_2 = require("../models");
const vendorDto = (v) => ({
    id: String(v._id), name: v.name, gstin: v.gstin, pan: v.pan, category: v.category, payment_terms_days: v.payment_terms_days, tds_section: v.tds_section,
    status: v.status, contact_name: v.contact_name, contact_email: v.contact_email, contact_phone: v.contact_phone, address: v.address,
    bank: v.bank ? { account_name: v.bank.account_name, account_masked: (0, crypto_1.maskAccount)(v.bank.account_last4), ifsc: v.bank.ifsc, bank_name: v.bank.bank_name } : null,
    proposed_by: v.proposed_by ? String(v.proposed_by) : null, approved_at: v.approved_at, createdAt: v.createdAt, rejection_reason: v.rejection_reason || null,
});
exports.vendorDto = vendorDto;
function bankFromInput(b) {
    if (!b)
        return null;
    if (!(0, validators_1.isValidIfsc)(b.ifsc))
        throw (0, errors_1.badRequest)('IFSC code is not valid (4 letters, 0, then 6 letters or digits).');
    const acct = String(b.account_number || '').replace(/\s/g, '');
    if (!/^\d{6,20}$/.test(acct))
        throw (0, errors_1.badRequest)('Account number must be 6 to 20 digits.');
    return { account_name: b.account_name, account_number_enc: (0, crypto_1.encryptSecret)(acct), account_last4: (0, crypto_1.last4)(acct), ifsc: b.ifsc.toUpperCase(), bank_name: b.bank_name || null };
}
function checkIds(gstin, pan) {
    if (gstin) {
        const g = (0, validators_1.validateGstin)(gstin);
        if (!g.structure || !g.stateCode)
            throw (0, errors_1.badRequest)('GSTIN is not valid.');
        if (!g.checksum)
            throw (0, errors_1.badRequest)('GSTIN check digit is wrong. Please re-check the number.');
    }
    if (pan && !(0, validators_1.isValidPan)(pan))
        throw (0, errors_1.badRequest)('PAN is not valid.');
}
async function listVendors(actor, req) {
    const f = { organisation_id: actor.orgId };
    if (req.query.status)
        f.status = String(req.query.status);
    if (req.query.q)
        f.name = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const page = await (0, paginate_1.paginate)(models_1.Vendor.find(f).sort({ name: 1 }), models_1.Vendor.countDocuments(f), req);
    // Counts per status for the filter chips; they ignore the current filter so the chips stay stable.
    const grouped = await models_1.Vendor.aggregate([{ $match: { organisation_id: models_1.Vendor.schema.path('organisation_id').cast(actor.orgId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const counts = { active: 0, pending_approval: 0, inactive: 0, rejected: 0 };
    for (const g of grouped)
        counts[g._id] = g.n;
    return { ...page, data: page.data.map(exports.vendorDto), counts };
}
async function getVendor(actor, id) {
    const v = await models_1.Vendor.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!v)
        throw (0, errors_1.notFound)('Vendor');
    return { ...(0, exports.vendorDto)(v), stats: await vendorStats(actor.orgId, id) };
}
const OPEN_STATUSES = ['in_review', 'on_hold', 'approved', 'scheduled', 'released'];
/** Invoice totals for one vendor: how many, how much is still payable, how much is paid. */
async function vendorStats(orgId, vendorId) {
    const rows = await models_1.Invoice.aggregate([
        { $match: { organisation_id: models_1.Invoice.schema.path('organisation_id').cast(orgId), vendor_id: models_1.Invoice.schema.path('vendor_id').cast(vendorId) } },
        { $group: { _id: null, invoice_count: { $sum: 1 }, last_invoice_date: { $max: '$invoice_date' },
                open_minor: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, '$net_payable_minor', 0] } },
                paid_minor: { $sum: { $cond: [{ $in: ['$status', ['paid', 'reconciled']] }, '$net_payable_minor', 0] } } } }
    ]);
    const r = rows[0];
    return { invoice_count: r?.invoice_count ?? 0, open_minor: r?.open_minor ?? 0, paid_minor: r?.paid_minor ?? 0, last_invoice_date: r?.last_invoice_date ?? null };
}
async function approvers(orgId, perm) {
    const roles = (await models_2.Role.find({ organisation_id: orgId, permissions: perm }).lean()).map((r) => r._id);
    return (await models_2.User.find({ organisation_id: orgId, is_active: true, role_id: { $in: roles } }).lean()).map((u) => u._id);
}
async function proposeVendor(actor, input) {
    checkIds(input.gstin, input.pan);
    const bank = bankFromInput(input.bank);
    return (0, txn_1.withTxn)(async (session) => {
        const [v] = await models_1.Vendor.create([{ organisation_id: actor.orgId, name: input.name, gstin: input.gstin || null, pan: input.pan || (input.gstin ? (0, validators_1.validateGstin)(input.gstin).pan : null),
                category: input.category || null, payment_terms_days: input.payment_terms_days ?? 30, tds_section: input.tds_section || null, contact_name: input.contact_name, contact_email: input.contact_email,
                contact_phone: input.contact_phone, address: input.address, bank, status: 'pending_approval', proposed_by: actor.userId }], { session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'vendor.proposed', entity_type: 'Vendor', entity_id: v._id, new_values: { name: v.name, gstin: v.gstin, ifsc: bank?.ifsc, account_last4: bank?.account_last4 } }, session);
        await (0, notification_service_1.notifyMany)(actor.orgId, await approvers(actor.orgId, 'vendor.approve'), { kind: 'vendor.pending', title: 'New vendor needs approval', body: `${v.name} was proposed by ${actor.name}.`, entity_type: 'Vendor', entity_id: v._id }, session);
        return (0, exports.vendorDto)(v);
    });
}
async function decideVendor(actor, id, decision, note) {
    const v = await models_1.Vendor.findOne({ _id: id, organisation_id: actor.orgId });
    if (!v)
        throw (0, errors_1.notFound)('Vendor');
    if (v.status !== 'pending_approval')
        throw (0, errors_1.conflict)(`Vendor is already ${v.status}.`, 'ALREADY_DECIDED');
    const viol = (0, policy_1.checkProposerApproval)(await (0, org_service_1.getSod)(actor.orgId), actor.userId, v.proposed_by);
    if (viol)
        throw (0, errors_1.forbidden)(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
    if (decision === 'reject' && !note)
        throw (0, errors_1.badRequest)('A reason is required to reject a vendor.');
    return (0, txn_1.withTxn)(async (session) => {
        v.status = decision === 'approve' ? 'active' : 'rejected';
        v.approved_by = actor.userId;
        v.approved_at = new Date();
        v.rejection_reason = decision === 'reject' ? note : undefined;
        await v.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: `vendor.${decision}d`, entity_type: 'Vendor', entity_id: id, metadata: { note } }, session);
        return (0, exports.vendorDto)(v);
    });
}
/** Contact details can be edited by proposers; identity, tax and terms changes need vendor.approve. */
async function updateVendor(actor, id, patch) {
    const v = await models_1.Vendor.findOne({ _id: id, organisation_id: actor.orgId });
    if (!v)
        throw (0, errors_1.notFound)('Vendor');
    const sensitive = ['name', 'gstin', 'pan', 'category', 'payment_terms_days', 'tds_section', 'status'].filter((k) => patch[k] !== undefined);
    if (sensitive.length && !actor.permissions.has('vendor.approve'))
        throw (0, errors_1.forbidden)(`Changing ${sensitive.join(', ')} needs the vendor.approve permission.`, 'MISSING_PERMISSION');
    checkIds(patch.gstin, patch.pan);
    // Only an approved vendor can be switched between active and inactive. Pending and rejected vendors go through approve/reject.
    if (patch.status !== undefined && patch.status !== v.status) {
        if (!['active', 'inactive'].includes(v.status))
            throw (0, errors_1.conflict)(`A vendor that is ${v.status.replace('_', ' ')} cannot be made ${patch.status}. Use approve or reject.`, 'BAD_STATE');
    }
    if (patch.status === 'inactive' && v.status === 'active') {
        const open = await models_1.Invoice.countDocuments({ organisation_id: actor.orgId, vendor_id: id, status: { $in: ['approved', 'scheduled', 'released'] } });
        if (open > 0)
            throw (0, errors_1.conflict)(`${open} approved or scheduled invoice(s) still need payment. Pay or return them before deactivating this vendor.`, 'OPEN_INVOICES');
    }
    const before = {};
    const next = {};
    for (const k of ['contact_name', 'contact_email', 'contact_phone', 'address', ...sensitive])
        if (patch[k] !== undefined) {
            before[k] = v[k];
            v[k] = patch[k];
            next[k] = patch[k];
        }
    return (0, txn_1.withTxn)(async (session) => { await v.save({ session }); await (0, audit_service_1.writeAudit)(actor, { action: 'vendor.updated', entity_type: 'Vendor', entity_id: id, old_values: before, new_values: next }, session); return (0, exports.vendorDto)(v); });
}
// ---- bank detail changes: a second person must approve
async function proposeBankChange(actor, id, input) {
    const v = await models_1.Vendor.findOne({ _id: id, organisation_id: actor.orgId });
    if (!v)
        throw (0, errors_1.notFound)('Vendor');
    if (await models_1.VendorChange.findOne({ organisation_id: actor.orgId, vendor_id: id, status: 'pending' }).lean())
        throw (0, errors_1.conflict)('A bank change is already waiting for approval.', 'PENDING_EXISTS');
    const bank = bankFromInput(input.bank);
    return (0, txn_1.withTxn)(async (session) => {
        const [c] = await models_1.VendorChange.create([{ organisation_id: actor.orgId, vendor_id: id, bank, reason: input.reason, proposed_by: actor.userId }], { session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'vendor.bank_change_proposed', entity_type: 'Vendor', entity_id: id, old_values: { account_last4: v.bank?.account_last4, ifsc: v.bank?.ifsc }, new_values: { account_last4: bank.account_last4, ifsc: bank.ifsc }, metadata: { reason: input.reason } }, session);
        await (0, notification_service_1.notifyMany)(actor.orgId, await approvers(actor.orgId, 'vendor.bank_change.approve'), { kind: 'vendor.bank_change', title: 'Vendor bank change needs approval', body: `${v.name}: new account ending ${bank.account_last4}.`, entity_type: 'Vendor', entity_id: id }, session);
        return { id: String(c._id), status: c.status };
    });
}
async function listBankChanges(actor) {
    const rows = await models_1.VendorChange.find({ organisation_id: actor.orgId, status: 'pending' }).sort({ createdAt: -1 }).lean();
    const vendors = new Map((await models_1.Vendor.find({ organisation_id: actor.orgId, _id: { $in: rows.map((r) => r.vendor_id) } }).lean()).map((v) => [String(v._id), v]));
    return rows.map((r) => ({ id: String(r._id), vendor_id: String(r.vendor_id), vendor_name: vendors.get(String(r.vendor_id))?.name, current: vendors.get(String(r.vendor_id))?.bank ? { account_masked: (0, crypto_1.maskAccount)(vendors.get(String(r.vendor_id)).bank.account_last4), ifsc: vendors.get(String(r.vendor_id)).bank.ifsc } : null,
        proposed: { account_masked: (0, crypto_1.maskAccount)(r.bank.account_last4), ifsc: r.bank.ifsc, account_name: r.bank.account_name }, reason: r.reason, proposed_by: String(r.proposed_by), createdAt: r.createdAt }));
}
async function decideBankChange(actor, changeId, decision, note) {
    const c = await models_1.VendorChange.findOne({ _id: changeId, organisation_id: actor.orgId });
    if (!c)
        throw (0, errors_1.notFound)('Bank change');
    if (c.status !== 'pending')
        throw (0, errors_1.conflict)(`Already ${c.status}.`, 'ALREADY_DECIDED');
    const viol = (0, policy_1.checkProposerApproval)(await (0, org_service_1.getSod)(actor.orgId), actor.userId, c.proposed_by);
    if (viol)
        throw (0, errors_1.forbidden)(viol.message, 'SOD_VIOLATION', { rule: viol.rule });
    return (0, txn_1.withTxn)(async (session) => {
        c.status = decision === 'approve' ? 'approved' : 'rejected';
        c.decided_by = actor.userId;
        c.decided_at = new Date();
        c.decision_note = note;
        await c.save({ session });
        if (decision === 'approve')
            await models_1.Vendor.updateOne({ _id: c.vendor_id, organisation_id: actor.orgId }, { $set: { bank: c.bank } }, { session });
        await (0, audit_service_1.writeAudit)(actor, { action: `vendor.bank_change_${decision}d`, entity_type: 'Vendor', entity_id: c.vendor_id, metadata: { change_id: changeId, note } }, session);
        return { id: changeId, status: c.status };
    });
}
/** Full account number: only with vendor.bank_reveal, and every reveal is audited. */
async function revealBank(actor, id) {
    const v = await models_1.Vendor.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!v?.bank?.account_number_enc)
        throw (0, errors_1.notFound)('Bank details');
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'vendor.bank_revealed', entity_type: 'Vendor', entity_id: id }, s));
    return { account_name: v.bank.account_name, account_number: (0, crypto_1.decryptSecret)(v.bank.account_number_enc), ifsc: v.bank.ifsc, bank_name: v.bank.bank_name };
}
/** Minimal vendor picker data for people who create invoices but may not browse the vendor master. */
async function listOptions(actor) {
    const rows = await models_1.Vendor.find({ organisation_id: actor.orgId, status: { $in: ['active', 'pending_approval'] } }).sort({ name: 1 }).limit(1000).lean();
    return rows.map((v) => ({ id: String(v._id), name: v.name, status: v.status, gstin: v.gstin, tds_section: v.tds_section, category: v.category }));
}
//# sourceMappingURL=vendor.service.js.map