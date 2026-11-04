"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTransition = exports.invoiceDto = void 0;
exports.visibilityFilter = visibilityFilter;
exports.loadVisible = loadVisible;
exports.createInvoice = createInvoice;
exports.updateInvoice = updateInvoice;
exports.listInvoices = listInvoices;
exports.getInvoiceDetail = getInvoiceDetail;
exports.addComment = addComment;
exports.downloadInvoiceFile = downloadInvoiceFile;
exports.attachFile = attachFile;
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const validators_1 = require("../lib/validators");
const tax_1 = require("../domain/tax");
const stateMachine_1 = require("../domain/stateMachine");
Object.defineProperty(exports, "assertTransition", { enumerable: true, get: function () { return stateMachine_1.assertTransition; } });
const paginate_1 = require("../lib/paginate");
const storage_1 = require("./storage");
const invoiceDto = (i) => ({
    id: String(i._id), number: i.number, vendor_id: String(i.vendor_id), status: i.status, currency: i.currency,
    subtotal_minor: i.subtotal_minor, cgst_minor: i.cgst_minor, sgst_minor: i.sgst_minor, igst_minor: i.igst_minor, cess_minor: i.cess_minor, round_off_minor: i.round_off_minor, total_minor: i.total_minor,
    tds_section: i.tds_section, tds_rate_bps: i.tds_rate_bps, tds_minor: i.tds_minor, net_payable_minor: i.net_payable_minor,
    invoice_date: i.invoice_date, due_date: i.due_date, department: i.department, cost_centre: i.cost_centre, description: i.description,
    line_items: i.line_items, has_file: !!i.file?.key, file_name: i.file?.name, rule_name: i.rule_name, approval_mode: i.approval_mode,
    created_by: String(i.created_by), hold: i.hold?.reason ? i.hold : null, rejection: i.rejection?.reason ? i.rejection : null,
    duplicate_override: i.duplicate_override?.reason ? { reason: i.duplicate_override.reason } : null,
    submitted_at: i.submitted_at, approved_at: i.approved_at, createdAt: i.createdAt, updatedAt: i.updatedAt,
});
exports.invoiceDto = invoiceDto;
/** Which invoices this user may see: all, only assigned ones, or only their own. */
async function visibilityFilter(actor) {
    if (actor.permissions.has('invoice.view_all'))
        return {};
    const or = [];
    if (actor.permissions.has('invoice.view_own') || actor.permissions.has('invoice.create_own') || actor.permissions.has('invoice.create'))
        or.push({ created_by: actor.userId });
    if (actor.permissions.has('invoice.view_assigned')) {
        const ids = await models_1.ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, $or: [{ approver_id: actor.userId }, { acted_by: actor.userId }] });
        or.push({ _id: { $in: ids } });
    }
    return or.length ? { $or: or } : null;
}
async function loadVisible(actor, id) {
    const vis = await visibilityFilter(actor);
    if (vis === null)
        throw (0, errors_1.forbidden)('You cannot view invoices.');
    const inv = await models_1.Invoice.findOne({ _id: id, organisation_id: actor.orgId, ...vis });
    if (!inv)
        throw (0, errors_1.notFound)('Invoice');
    return inv;
}
async function priceInvoice(orgId, vendor, input) {
    const t = { subtotal_minor: input.subtotal_minor, cgst_minor: input.cgst_minor || 0, sgst_minor: input.sgst_minor || 0, igst_minor: input.igst_minor || 0, cess_minor: input.cess_minor || 0, round_off_minor: input.round_off_minor || 0, total_minor: input.total_minor };
    for (const [k, v] of Object.entries(t))
        if (!Number.isSafeInteger(v))
            throw (0, errors_1.badRequest)(`${k} must be a whole number of paise.`);
    if (t.subtotal_minor <= 0 || t.total_minor <= 0)
        throw (0, errors_1.badRequest)('Amounts must be greater than zero.');
    const chk = (0, tax_1.checkTotals)(t);
    if (!chk.ok)
        throw (0, errors_1.badRequest)(`Taxable value plus taxes and round-off is ${chk.expected_minor} paise but the total is ${t.total_minor} paise.`, { expected_minor: chk.expected_minor }, 'TOTAL_MISMATCH');
    if (input.line_items?.length) {
        const sum = input.line_items.reduce((a, l) => a + l.amount_minor, 0);
        if (sum !== t.subtotal_minor)
            throw (0, errors_1.badRequest)(`Line items add up to ${sum} paise but the taxable value is ${t.subtotal_minor} paise.`, undefined, 'LINES_MISMATCH');
    }
    const org = await models_1.Organisation.findById(orgId).lean();
    let tds = { section: null, rate_bps: 0, amount_minor: 0 };
    try {
        tds = (0, tax_1.computeTds)(t.subtotal_minor, vendor.tds_section, org.settings?.tax?.tds_sections || []);
    }
    catch (e) {
        throw (0, errors_1.badRequest)(e.message, undefined, 'TDS_NOT_CONFIGURED');
    }
    return { ...t, tds_section: tds.section, tds_rate_bps: tds.rate_bps, tds_minor: tds.amount_minor, net_payable_minor: t.total_minor - tds.amount_minor };
}
async function checkDuplicates(orgId, vendorId, norm, total, invoiceDate, fileHash, override, ignoreId) {
    const notSelf = ignoreId ? { _id: { $ne: ignoreId } } : {};
    const same = await models_1.Invoice.findOne({ organisation_id: orgId, vendor_id: vendorId, number_norm: norm, ...notSelf }).lean();
    if (same)
        throw (0, errors_1.conflict)(`This vendor already has invoice ${same.number}. The same vendor and invoice number cannot be entered twice.`, 'DUPLICATE_INVOICE_NUMBER', { invoice_id: String(same._id) });
    if (fileHash) {
        const f = await models_1.Invoice.findOne({ organisation_id: orgId, 'file.hash': fileHash, ...notSelf }).lean();
        if (f)
            throw (0, errors_1.conflict)('This exact file is already attached to another invoice.', 'DUPLICATE_FILE', { invoice_id: String(f._id) });
    }
    const win = 30 * 86400000;
    const similar = await models_1.Invoice.findOne({ organisation_id: orgId, vendor_id: vendorId, total_minor: total, invoice_date: { $gte: new Date(invoiceDate.getTime() - win), $lte: new Date(invoiceDate.getTime() + win) }, ...notSelf }).lean();
    if (similar) {
        if (!override || override.trim().length < 10)
            throw (0, errors_1.conflict)(`Possible duplicate: invoice ${similar.number} has the same vendor and amount within 30 days. Provide a reason (at least 10 characters) to continue.`, 'POSSIBLE_DUPLICATE', { similar_invoice_id: String(similar._id), similar_number: similar.number });
        return { reason: override.trim(), similar_invoice_id: similar._id };
    }
    return null;
}
async function createInvoice(actor, input, session) {
    if (!actor.permissions.has('invoice.create') && !actor.permissions.has('invoice.create_own'))
        throw (0, errors_1.forbidden)('You cannot create invoices.', 'MISSING_PERMISSION');
    const vendor = await models_1.Vendor.findOne({ _id: input.vendor_id, organisation_id: actor.orgId }).lean();
    if (!vendor)
        throw (0, errors_1.badRequest)('Vendor not found.');
    if (!['active', 'pending_approval'].includes(vendor.status))
        throw (0, errors_1.badRequest)(`Vendor is ${vendor.status}.`);
    const priced = await priceInvoice(actor.orgId, vendor, input);
    const norm = (0, validators_1.normaliseInvoiceNumber)(input.number);
    if (!norm)
        throw (0, errors_1.badRequest)('Invoice number is required.');
    if (input.due_date < input.invoice_date)
        throw (0, errors_1.badRequest)('Due date cannot be before the invoice date.');
    const dup = await checkDuplicates(actor.orgId, input.vendor_id, norm, input.total_minor, input.invoice_date, input.file?.hash, input.duplicate_override_reason);
    const run = async (s) => {
        const [inv] = await models_1.Invoice.create([{ organisation_id: actor.orgId, number: input.number.trim(), number_norm: norm, vendor_id: input.vendor_id, created_by: actor.userId, status: 'draft',
                currency: input.currency || 'INR', ...priced, invoice_date: input.invoice_date, due_date: input.due_date, department: input.department || null, cost_centre: input.cost_centre || null,
                description: input.description || '', line_items: input.line_items || [], file: input.file || null, intake_id: input.intake_id, duplicate_override: dup || undefined }], { session: s });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.created', entity_type: 'Invoice', entity_id: inv._id, new_values: { number: inv.number, vendor_id: inv.vendor_id, total_minor: inv.total_minor }, metadata: dup ? { duplicate_override: dup.reason } : undefined }, s);
        return inv;
    };
    return session ? run(session) : (0, txn_1.withTxn)(run);
}
async function updateInvoice(actor, id, patch) {
    const inv = await loadVisible(actor, id);
    const mine = String(inv.created_by) === actor.userId;
    if (!actor.permissions.has('invoice.edit_before_approval') && !(mine && actor.permissions.has('invoice.create_own')))
        throw (0, errors_1.forbidden)('You cannot edit this invoice.', 'MISSING_PERMISSION');
    if (!['draft', 'on_hold'].includes(inv.status))
        throw (0, errors_1.conflict)(`An invoice that is ${inv.status} cannot be edited.`, 'NOT_EDITABLE');
    const vendor = await models_1.Vendor.findOne({ _id: patch.vendor_id || inv.vendor_id, organisation_id: actor.orgId }).lean();
    if (!vendor)
        throw (0, errors_1.badRequest)('Vendor not found.');
    const merged = { ...inv.toObject(), ...patch };
    const priced = await priceInvoice(actor.orgId, vendor, merged);
    const number = (patch.number ?? inv.number).trim();
    const norm = (0, validators_1.normaliseInvoiceNumber)(number);
    if (merged.due_date < merged.invoice_date)
        throw (0, errors_1.badRequest)('Due date cannot be before the invoice date.');
    const dup = await checkDuplicates(actor.orgId, String(vendor._id), norm, merged.total_minor, merged.invoice_date, inv.file?.hash, patch.duplicate_override_reason || inv.duplicate_override?.reason, id);
    const before = (0, exports.invoiceDto)(inv);
    return (0, txn_1.withTxn)(async (session) => {
        Object.assign(inv, { number, number_norm: norm, vendor_id: vendor._id, ...priced, invoice_date: merged.invoice_date, due_date: merged.due_date, department: merged.department ?? null, cost_centre: merged.cost_centre ?? null, description: merged.description ?? '', line_items: merged.line_items || [] });
        if (dup)
            inv.duplicate_override = dup;
        if (!inv.edited_by.map(String).includes(actor.userId) && mine === false)
            inv.edited_by.push(actor.userId);
        if (mine === false && !inv.edited_by.map(String).includes(actor.userId))
            inv.edited_by.push(actor.userId);
        // Editing an invoice that was on hold invalidates its approvals: it goes back to draft and must be resubmitted.
        if (inv.status === 'on_hold') {
            await models_1.ApprovalStep.updateMany({ organisation_id: actor.orgId, invoice_id: id, status: 'pending' }, { $set: { status: 'cancelled' } }, { session });
            inv.status = 'draft';
            inv.hold = undefined;
        }
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.updated', entity_type: 'Invoice', entity_id: id, old_values: before, new_values: (0, exports.invoiceDto)(inv) }, session);
        return (0, exports.invoiceDto)(inv);
    });
}
async function listInvoices(actor, req) {
    const vis = await visibilityFilter(actor);
    if (vis === null)
        throw (0, errors_1.forbidden)('You cannot view invoices.');
    const f = { organisation_id: actor.orgId, ...vis };
    const q = req.query;
    if (q.status)
        f.status = { $in: String(q.status).split(',') };
    if (q.vendor_id)
        f.vendor_id = String(q.vendor_id);
    if (q.department)
        f.department = String(q.department);
    if (q.q)
        f.number = { $regex: String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (q.due_from || q.due_to)
        f.due_date = { ...(q.due_from ? { $gte: new Date(String(q.due_from)) } : {}), ...(q.due_to ? { $lte: new Date(String(q.due_to)) } : {}) };
    const page = await (0, paginate_1.paginate)(models_1.Invoice.find(f).sort({ createdAt: -1 }), models_1.Invoice.countDocuments(f), req);
    const vendors = new Map((await models_1.Vendor.find({ organisation_id: actor.orgId, _id: { $in: page.data.map((i) => i.vendor_id) } }).lean()).map((v) => [String(v._id), v.name]));
    return { ...page, data: page.data.map((i) => ({ ...(0, exports.invoiceDto)(i), vendor_name: vendors.get(String(i.vendor_id)) })) };
}
async function getInvoiceDetail(actor, id) {
    const inv = await loadVisible(actor, id);
    const vendor = await models_1.Vendor.findOne({ _id: inv.vendor_id, organisation_id: actor.orgId }).lean();
    const steps = await models_1.ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id }).sort({ round: 1, step_order: 1 }).lean();
    const users = new Map((await models_1.User.find({ organisation_id: actor.orgId, _id: { $in: [...steps.map((s) => s.approver_id), ...steps.map((s) => s.acted_by).filter(Boolean), inv.created_by] } }).lean()).map((u) => [String(u._id), u.full_name]));
    const comments = await models_1.InvoiceComment.find({ organisation_id: actor.orgId, invoice_id: id }).sort({ createdAt: 1 }).lean();
    const cu = new Map((await models_1.User.find({ organisation_id: actor.orgId, _id: { $in: comments.map((c) => c.author_id) } }).lean()).map((u) => [String(u._id), u.full_name]));
    return {
        ...(0, exports.invoiceDto)(inv), vendor_name: vendor?.name, vendor_gstin: vendor?.gstin, created_by_name: users.get(String(inv.created_by)),
        approval_steps: steps.map((s) => ({ id: String(s._id), step_order: s.step_order, round: s.round, status: s.status, approver_id: String(s.approver_id), approver_name: users.get(String(s.approver_id)),
            acted_by_name: s.acted_by ? users.get(String(s.acted_by)) : null, comment: s.comment, decided_at: s.decided_at, activated_at: s.activated_at, escalated_at: s.escalated_at })),
        comments: comments.map((c) => ({ id: String(c._id), kind: c.kind, body: c.body, author_name: cu.get(String(c.author_id)), createdAt: c.createdAt })),
    };
}
async function addComment(actor, id, body, kind = 'comment') {
    const inv = await loadVisible(actor, id);
    if (!actor.permissions.has('invoice.comment'))
        throw (0, errors_1.forbidden)('You cannot comment on invoices.', 'MISSING_PERMISSION');
    return (0, txn_1.withTxn)(async (s) => {
        const [c] = await models_1.InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind, body }], { session: s });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.commented', entity_type: 'Invoice', entity_id: id, metadata: { kind } }, s);
        return { id: String(c._id), kind, body };
    });
}
async function downloadInvoiceFile(actor, id) {
    const inv = await loadVisible(actor, id);
    if (!inv.file?.key)
        throw (0, errors_1.notFound)('Document');
    const buf = await (0, storage_1.storage)().read(inv.file.key);
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'invoice.file_downloaded', entity_type: 'Invoice', entity_id: id }, s));
    return { buffer: buf, mime: inv.file.mime, name: inv.file.name };
}
async function attachFile(actor, id, file) {
    const inv = await loadVisible(actor, id);
    const mine = String(inv.created_by) === actor.userId;
    if (!actor.permissions.has('invoice.upload') && !(mine && actor.permissions.has('invoice.create_own')))
        throw (0, errors_1.forbidden)('You cannot upload documents.', 'MISSING_PERMISSION');
    if (!['draft', 'on_hold'].includes(inv.status))
        throw (0, errors_1.conflict)('Documents can only be attached while the invoice is draft or on hold.', 'NOT_EDITABLE');
    const saved = await (0, storage_1.storage)().save(file.buffer, file.name, file.mime, `${actor.orgId}/invoices`);
    const dupe = await models_1.Invoice.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash, _id: { $ne: id } }).lean();
    if (dupe) {
        await (0, storage_1.storage)().remove(saved.key);
        throw (0, errors_1.conflict)('This exact file is already attached to another invoice.', 'DUPLICATE_FILE');
    }
    return (0, txn_1.withTxn)(async (s) => {
        inv.file = { key: saved.key, name: saved.originalName, size: saved.fileSize, hash: saved.fileHash, mime: saved.mimeType };
        await inv.save({ session: s });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.file_attached', entity_type: 'Invoice', entity_id: id, new_values: { hash: saved.fileHash, size: saved.fileSize } }, s);
        return (0, exports.invoiceDto)(inv);
    });
}
//# sourceMappingURL=invoice.service.js.map