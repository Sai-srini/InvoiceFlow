"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalStep = exports.ApprovalRule = exports.InvoiceComment = exports.Invoice = exports.VendorChange = exports.Vendor = void 0;
const mongoose_1 = require("mongoose");
const plugins_1 = require("./plugins");
const bank = new mongoose_1.Schema({
    account_name: String, account_number_enc: String, account_last4: String, ifsc: String, bank_name: String,
}, { _id: false });
exports.Vendor = (0, plugins_1.model)('Vendor', (() => {
    const s = new mongoose_1.Schema({
        name: { type: String, required: true, trim: true }, gstin: { type: String, default: null, uppercase: true }, pan: { type: String, default: null, uppercase: true },
        category: { type: String, default: null }, payment_terms_days: { type: Number, default: 30 },
        tds_section: { type: String, default: null },
        status: { type: String, enum: ['pending_approval', 'active', 'inactive', 'rejected'], default: 'pending_approval' },
        contact_name: String, contact_email: String, contact_phone: String, address: String,
        bank: { type: bank, default: null },
        proposed_by: (0, plugins_1.oid)('User'), approved_by: (0, plugins_1.oid)('User'), approved_at: Date, rejection_reason: String,
    }, { timestamps: true });
    s.index({ organisation_id: 1, gstin: 1 }, { unique: true, partialFilterExpression: { gstin: { $type: 'string' } } });
    s.index({ organisation_id: 1, name: 1 });
    return s;
})());
exports.VendorChange = (0, plugins_1.model)('VendorChange', new mongoose_1.Schema({
    vendor_id: (0, plugins_1.oid)('Vendor', true), bank: { type: bank, required: true }, reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    proposed_by: (0, plugins_1.oid)('User', true), decided_by: (0, plugins_1.oid)('User'), decided_at: Date, decision_note: String,
}, { timestamps: true }));
const lineItem = new mongoose_1.Schema({ description: String, amount_minor: (0, plugins_1.minor)(true), gl_code: String, quantity: Number, hsn: String }, { _id: false });
const fileRef = new mongoose_1.Schema({ key: String, name: String, size: Number, hash: String, mime: String }, { _id: false });
exports.Invoice = (0, plugins_1.model)('Invoice', (() => {
    const s = new mongoose_1.Schema({
        number: { type: String, required: true, trim: true }, number_norm: { type: String, required: true },
        vendor_id: (0, plugins_1.oid)('Vendor', true), created_by: (0, plugins_1.oid)('User', true), edited_by: [(0, plugins_1.oid)('User')],
        status: { type: String, enum: ['draft', 'in_review', 'approved', 'rejected', 'on_hold', 'scheduled', 'released', 'paid', 'reconciled'], default: 'draft', index: true },
        currency: { type: String, default: 'INR' },
        subtotal_minor: (0, plugins_1.minor)(true), cgst_minor: { ...(0, plugins_1.minor)(), default: 0 }, sgst_minor: { ...(0, plugins_1.minor)(), default: 0 }, igst_minor: { ...(0, plugins_1.minor)(), default: 0 },
        cess_minor: { ...(0, plugins_1.minor)(), default: 0 }, round_off_minor: { ...(0, plugins_1.minor)(), default: 0 }, total_minor: (0, plugins_1.minor)(true),
        tds_section: { type: String, default: null }, tds_rate_bps: { type: Number, default: 0 }, tds_minor: { ...(0, plugins_1.minor)(), default: 0 }, net_payable_minor: (0, plugins_1.minor)(true),
        invoice_date: { type: Date, required: true }, due_date: { type: Date, required: true },
        department: { type: String, default: null }, cost_centre: { type: String, default: null }, description: { type: String, default: '' },
        line_items: [lineItem], file: { type: fileRef, default: null }, intake_id: (0, plugins_1.oid)('IntakeDocument'),
        rule_id: (0, plugins_1.oid)('ApprovalRule'), rule_name: String, approval_mode: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
        submitted_at: Date, approved_at: Date, approval_round: { type: Number, default: 0 },
        hold: { reason: String, by: (0, plugins_1.oid)('User'), at: Date },
        rejection: { reason: String, by: (0, plugins_1.oid)('User'), at: Date },
        duplicate_override: { reason: String, by: (0, plugins_1.oid)('User'), at: Date, similar_invoice_id: (0, plugins_1.oid)('Invoice') },
    }, { timestamps: true });
    s.index({ organisation_id: 1, vendor_id: 1, number_norm: 1 }, { unique: true });
    s.index({ organisation_id: 1, status: 1, due_date: 1 });
    s.index({ organisation_id: 1, 'file.hash': 1 });
    return s;
})());
exports.InvoiceComment = (0, plugins_1.model)('InvoiceComment', new mongoose_1.Schema({
    invoice_id: (0, plugins_1.oid)('Invoice', true), author_id: (0, plugins_1.oid)('User', true),
    kind: { type: String, enum: ['comment', 'query', 'response', 'decision'], default: 'comment' }, body: { type: String, required: true, maxlength: 4000 },
}, { timestamps: true }));
exports.ApprovalRule = (0, plugins_1.model)('ApprovalRule', new mongoose_1.Schema({
    name: { type: String, required: true }, min_minor: { ...(0, plugins_1.minor)(true), default: 0 }, max_minor: { type: Number, default: null },
    department: { type: String, default: null }, cost_centre: { type: String, default: null }, vendor_category: { type: String, default: null },
    approvers_required: { type: Number, default: 1, min: 1, max: 5 }, mode: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
    role_ids: [(0, plugins_1.oid)('Role')], user_ids: [(0, plugins_1.oid)('User')], escalation_hours: { type: Number, default: 24 },
    priority: { type: Number, default: 0 }, is_active: { type: Boolean, default: true },
}, { timestamps: true }));
exports.ApprovalStep = (0, plugins_1.model)('ApprovalStep', (() => {
    const s = new mongoose_1.Schema({
        invoice_id: (0, plugins_1.oid)('Invoice', true), approver_id: (0, plugins_1.oid)('User', true), step_order: { type: Number, required: true }, round: { type: Number, default: 1 },
        status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
        acted_by: (0, plugins_1.oid)('User'), on_behalf_of: (0, plugins_1.oid)('User'), comment: String, decided_at: Date,
        activated_at: { type: Date, default: null }, escalated_at: { type: Date, default: null }, escalation_hours: { type: Number, default: 24 },
    }, { timestamps: true });
    s.index({ organisation_id: 1, invoice_id: 1, step_order: 1 });
    s.index({ organisation_id: 1, approver_id: 1, status: 1 });
    return s;
})());
//# sourceMappingURL=finance.js.map