import { Schema } from 'mongoose';
import { model, oid, minor } from './plugins';

const bank = new Schema({
  account_name: String, account_number_enc: String, account_last4: String, ifsc: String, bank_name: String,
}, { _id: false });

export const Vendor = model('Vendor', (() => {
  const s = new Schema({
    name: { type: String, required: true, trim: true }, gstin: { type: String, default: null, uppercase: true }, pan: { type: String, default: null, uppercase: true },
    category: { type: String, default: null }, payment_terms_days: { type: Number, default: 30 },
    tds_section: { type: String, default: null },
    status: { type: String, enum: ['pending_approval', 'active', 'inactive', 'rejected'], default: 'pending_approval' },
    contact_name: String, contact_email: String, contact_phone: String, address: String,
    bank: { type: bank, default: null },
    proposed_by: oid('User'), approved_by: oid('User'), approved_at: Date, rejection_reason: String,
  }, { timestamps: true });
  s.index({ organisation_id: 1, gstin: 1 }, { unique: true, partialFilterExpression: { gstin: { $type: 'string' } } });
  s.index({ organisation_id: 1, name: 1 });
  return s;
})());

export const VendorChange = model('VendorChange', new Schema({
  vendor_id: oid('Vendor', true), bank: { type: bank, required: true }, reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  proposed_by: oid('User', true), decided_by: oid('User'), decided_at: Date, decision_note: String,
}, { timestamps: true }));

const lineItem = new Schema({ description: String, amount_minor: minor(true), gl_code: String, quantity: Number, hsn: String }, { _id: false });
const fileRef = new Schema({ key: String, name: String, size: Number, hash: String, mime: String }, { _id: false });

export const Invoice = model('Invoice', (() => {
  const s = new Schema({
    number: { type: String, required: true, trim: true }, number_norm: { type: String, required: true },
    vendor_id: oid('Vendor', true), created_by: oid('User', true), edited_by: [oid('User')],
    status: { type: String, enum: ['draft', 'in_review', 'approved', 'rejected', 'on_hold', 'scheduled', 'released', 'paid', 'reconciled'], default: 'draft', index: true },
    currency: { type: String, default: 'INR' },
    subtotal_minor: minor(true), cgst_minor: { ...minor(), default: 0 }, sgst_minor: { ...minor(), default: 0 }, igst_minor: { ...minor(), default: 0 },
    cess_minor: { ...minor(), default: 0 }, round_off_minor: { ...minor(), default: 0 }, total_minor: minor(true),
    tds_section: { type: String, default: null }, tds_rate_bps: { type: Number, default: 0 }, tds_minor: { ...minor(), default: 0 }, net_payable_minor: minor(true),
    invoice_date: { type: Date, required: true }, due_date: { type: Date, required: true },
    department: { type: String, default: null }, cost_centre: { type: String, default: null }, description: { type: String, default: '' },
    line_items: [lineItem], file: { type: fileRef, default: null }, intake_id: oid('IntakeDocument'),
    rule_id: oid('ApprovalRule'), rule_name: String, approval_mode: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
    submitted_at: Date, approved_at: Date, approval_round: { type: Number, default: 0 },
    hold: { reason: String, by: oid('User'), at: Date },
    rejection: { reason: String, by: oid('User'), at: Date },
    duplicate_override: { reason: String, by: oid('User'), at: Date, similar_invoice_id: oid('Invoice') },
  }, { timestamps: true });
  s.index({ organisation_id: 1, vendor_id: 1, number_norm: 1 }, { unique: true });
  s.index({ organisation_id: 1, status: 1, due_date: 1 });
  s.index({ organisation_id: 1, 'file.hash': 1 });
  return s;
})());

export const InvoiceComment = model('InvoiceComment', new Schema({
  invoice_id: oid('Invoice', true), author_id: oid('User', true),
  kind: { type: String, enum: ['comment', 'query', 'response', 'decision'], default: 'comment' }, body: { type: String, required: true, maxlength: 4000 },
}, { timestamps: true }));

export const ApprovalRule = model('ApprovalRule', new Schema({
  name: { type: String, required: true }, min_minor: { ...minor(true), default: 0 }, max_minor: { type: Number, default: null },
  department: { type: String, default: null }, cost_centre: { type: String, default: null }, vendor_category: { type: String, default: null },
  approvers_required: { type: Number, default: 1, min: 1, max: 5 }, mode: { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
  role_ids: [oid('Role')], user_ids: [oid('User')], escalation_hours: { type: Number, default: 24 },
  priority: { type: Number, default: 0 }, is_active: { type: Boolean, default: true },
}, { timestamps: true }));

export const ApprovalStep = model('ApprovalStep', (() => {
  const s = new Schema({
    invoice_id: oid('Invoice', true), approver_id: oid('User', true), step_order: { type: Number, required: true }, round: { type: Number, default: 1 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    acted_by: oid('User'), on_behalf_of: oid('User'), comment: String, decided_at: Date,
    activated_at: { type: Date, default: null }, escalated_at: { type: Date, default: null }, escalation_hours: { type: Number, default: 24 },
  }, { timestamps: true });
  s.index({ organisation_id: 1, invoice_id: 1, step_order: 1 });
  s.index({ organisation_id: 1, approver_id: 1, status: 1 });
  return s;
})());
