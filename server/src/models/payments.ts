import { Schema } from 'mongoose';
import { model, oid, minor } from './plugins';

export const PaymentRun = model('PaymentRun', (() => {
  const s = new Schema({
    number: { type: String, required: true }, status: { type: String, enum: ['draft', 'released', 'cancelled'], default: 'draft', index: true },
    prepared_by: oid('User', true), pay_date: { type: Date, required: true }, notes: String,
    count: Number, gross_minor: minor(), tds_minor: minor(), net_minor: minor(),
    required_signatures: { type: Number, default: 1 },
    signatures: [{ user_id: oid('User'), at: Date, _id: false }],
    file: { key: String, name: String, hash: String, generated_at: Date },
    released_at: Date, cancelled_by: oid('User'), cancel_reason: String,
  }, { timestamps: true });
  s.index({ organisation_id: 1, number: 1 }, { unique: true });
  return s;
})());

export const Payment = model('Payment', (() => {
  const s = new Schema({
    run_id: oid('PaymentRun', true), invoice_id: oid('Invoice', true), vendor_id: oid('Vendor', true),
    reference: { type: String, required: true }, vendor_name: String, invoice_number: String,
    gross_minor: minor(true), tds_minor: minor(true), net_minor: minor(true),
    status: { type: String, enum: ['scheduled', 'held', 'released', 'paid', 'failed', 'returned', 'cancelled'], default: 'scheduled', index: true },
    hold_reason: String, held_by: oid('User'), hold_released_by: oid('User'),
    released_at: Date, paid_at: Date, paid_via: { type: String, enum: ['bank_statement', 'manual'] },
    bank_reference: { type: String, default: null }, utr: { type: String, default: null }, confirmed_by: oid('User'),
    failure_reason: String, idempotency_key: String,
    reconciled_minor: { ...minor(), default: 0 }, reconciled: { type: Boolean, default: false },
    beneficiary: { name: String, account_last4: String, ifsc: String },
  }, { timestamps: true });
  s.index({ organisation_id: 1, reference: 1 }, { unique: true });
  s.index({ organisation_id: 1, invoice_id: 1, status: 1 });
  s.index({ organisation_id: 1, idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } });
  return s;
})());
