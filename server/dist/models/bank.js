"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconAllocation = exports.StatementLine = exports.StatementImport = exports.StatementProfile = exports.BankAccount = void 0;
const mongoose_1 = require("mongoose");
const plugins_1 = require("./plugins");
exports.BankAccount = (0, plugins_1.model)('BankAccount', new mongoose_1.Schema({
    name: { type: String, required: true }, bank_name: String, account_last4: String, ifsc: String, currency: { type: String, default: 'INR' },
    is_active: { type: Boolean, default: true },
}, { timestamps: true }));
exports.StatementProfile = (0, plugins_1.model)('StatementProfile', new mongoose_1.Schema({
    bank_account_id: (0, plugins_1.oid)('BankAccount', true), name: { type: String, required: true },
    format: { type: String, enum: ['csv', 'xlsx'], default: 'csv' },
    header_row: { type: Number, default: 0 }, date_column: String, date_format: { type: String, default: 'DD/MM/YYYY' },
    narration_column: String, reference_column: String,
    amount_mode: { type: String, enum: ['separate', 'signed', 'amount_drcr'], default: 'separate' },
    debit_column: String, credit_column: String, amount_column: String, drcr_column: String, balance_column: String,
    decimal_separator: { type: String, enum: ['.', ','], default: '.' }, skip_footer_rows: { type: Number, default: 0 },
}, { timestamps: true }));
exports.StatementImport = (0, plugins_1.model)('StatementImport', (() => {
    const s = new mongoose_1.Schema({
        bank_account_id: (0, plugins_1.oid)('BankAccount', true), profile_id: (0, plugins_1.oid)('StatementProfile', true), uploaded_by: (0, plugins_1.oid)('User', true),
        file_name: String, file_hash: { type: String, required: true }, line_count: Number, skipped_duplicates: Number,
        period_from: Date, period_to: Date, opening_minor: { type: Number, default: null }, closing_minor: { type: Number, default: null },
        balance_check: mongoose_1.Schema.Types.Mixed, parse_errors: mongoose_1.Schema.Types.Mixed, status: { type: String, default: 'imported' },
    }, { timestamps: true });
    s.index({ organisation_id: 1, bank_account_id: 1, file_hash: 1 }, { unique: true });
    return s;
})());
exports.StatementLine = (0, plugins_1.model)('StatementLine', (() => {
    const s = new mongoose_1.Schema({
        import_id: (0, plugins_1.oid)('StatementImport', true), bank_account_id: (0, plugins_1.oid)('BankAccount', true), row_number: Number,
        date: { type: Date, required: true }, narration: String, reference: { type: String, default: null },
        debit_minor: { ...(0, plugins_1.minor)(true), default: 0 }, credit_minor: { ...(0, plugins_1.minor)(true), default: 0 }, balance_minor: { type: Number, default: null },
        fingerprint: { type: String, required: true },
        status: { type: String, enum: ['unmatched', 'matched', 'partial', 'exception', 'suggested', 'pending_approval', 'classified', 'ignored'], default: 'unmatched', index: true },
        allocated_minor: { ...(0, plugins_1.minor)(), default: 0 },
        exception: { reason: String, candidates: [String] }, suggestion: mongoose_1.Schema.Types.Mixed, category: { type: String, default: null }, classified_by: (0, plugins_1.oid)('User'),
    }, { timestamps: true });
    s.index({ organisation_id: 1, bank_account_id: 1, fingerprint: 1 }, { unique: true });
    s.index({ organisation_id: 1, date: -1 });
    return s;
})());
exports.ReconAllocation = (0, plugins_1.model)('ReconAllocation', new mongoose_1.Schema({
    line_id: (0, plugins_1.oid)('StatementLine', true), payment_id: (0, plugins_1.oid)('Payment', true), amount_minor: (0, plugins_1.minor)(true),
    method: String, confidence: Number,
    state: { type: String, enum: ['confirmed', 'pending_approval', 'reversed', 'rejected'], default: 'confirmed', index: true },
    source: { type: String, enum: ['system', 'user'], default: 'system' },
    proposed_by: (0, plugins_1.oid)('User'), approved_by: (0, plugins_1.oid)('User'), approved_at: Date, reversed_by: (0, plugins_1.oid)('User'), reversed_reason: String,
}, { timestamps: true }));
//# sourceMappingURL=bank.js.map