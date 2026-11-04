"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Payment = exports.PaymentRun = void 0;
const mongoose_1 = require("mongoose");
const plugins_1 = require("./plugins");
exports.PaymentRun = (0, plugins_1.model)('PaymentRun', (() => {
    const s = new mongoose_1.Schema({
        number: { type: String, required: true }, status: { type: String, enum: ['draft', 'released', 'cancelled'], default: 'draft', index: true },
        prepared_by: (0, plugins_1.oid)('User', true), pay_date: { type: Date, required: true }, notes: String,
        count: Number, gross_minor: (0, plugins_1.minor)(), tds_minor: (0, plugins_1.minor)(), net_minor: (0, plugins_1.minor)(),
        required_signatures: { type: Number, default: 1 },
        signatures: [{ user_id: (0, plugins_1.oid)('User'), at: Date, _id: false }],
        file: { key: String, name: String, hash: String, generated_at: Date },
        released_at: Date, cancelled_by: (0, plugins_1.oid)('User'), cancel_reason: String,
    }, { timestamps: true });
    s.index({ organisation_id: 1, number: 1 }, { unique: true });
    return s;
})());
exports.Payment = (0, plugins_1.model)('Payment', (() => {
    const s = new mongoose_1.Schema({
        run_id: (0, plugins_1.oid)('PaymentRun', true), invoice_id: (0, plugins_1.oid)('Invoice', true), vendor_id: (0, plugins_1.oid)('Vendor', true),
        reference: { type: String, required: true }, vendor_name: String, invoice_number: String,
        gross_minor: (0, plugins_1.minor)(true), tds_minor: (0, plugins_1.minor)(true), net_minor: (0, plugins_1.minor)(true),
        status: { type: String, enum: ['scheduled', 'held', 'released', 'paid', 'failed', 'returned', 'cancelled'], default: 'scheduled', index: true },
        hold_reason: String, held_by: (0, plugins_1.oid)('User'), hold_released_by: (0, plugins_1.oid)('User'),
        released_at: Date, paid_at: Date, paid_via: { type: String, enum: ['bank_statement', 'manual'] },
        bank_reference: { type: String, default: null }, utr: { type: String, default: null }, confirmed_by: (0, plugins_1.oid)('User'),
        failure_reason: String, idempotency_key: String,
        reconciled_minor: { ...(0, plugins_1.minor)(), default: 0 }, reconciled: { type: Boolean, default: false },
        beneficiary: { name: String, account_last4: String, ifsc: String },
    }, { timestamps: true });
    s.index({ organisation_id: 1, reference: 1 }, { unique: true });
    s.index({ organisation_id: 1, invoice_id: 1, status: 1 });
    s.index({ organisation_id: 1, idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } });
    return s;
})());
//# sourceMappingURL=payments.js.map