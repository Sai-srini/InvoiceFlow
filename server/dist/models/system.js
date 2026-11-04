"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeDocument = exports.Notification = exports.AuditLog = void 0;
const mongoose_1 = require("mongoose");
const plugins_1 = require("./plugins");
const auditSchema = new mongoose_1.Schema({
    seq: { type: Number, required: true }, prev_hash: { type: String, required: true }, hash: { type: String, required: true },
    actor_id: { type: mongoose_1.Schema.Types.ObjectId, default: null }, action: { type: String, required: true },
    entity_type: String, entity_id: String, old_values: mongoose_1.Schema.Types.Mixed, new_values: mongoose_1.Schema.Types.Mixed, metadata: mongoose_1.Schema.Types.Mixed,
    ip: String, user_agent: String, at: { type: Date, required: true },
}, { minimize: false }); // keep {} exactly as hashed
auditSchema.index({ organisation_id: 1, seq: 1 }, { unique: true });
auditSchema.index({ organisation_id: 1, entity_type: 1, entity_id: 1 });
auditSchema.plugin(plugins_1.appendOnlyPlugin);
exports.AuditLog = (0, plugins_1.model)('AuditLog', auditSchema);
exports.Notification = (0, plugins_1.model)('Notification', new mongoose_1.Schema({
    user_id: (0, plugins_1.oid)('User', true), kind: String, title: String, body: String, entity_type: String, entity_id: String,
    email_state: { type: String, enum: ['not_applicable', 'pending', 'sent', 'undelivered', 'failed'], default: 'not_applicable' }, email_error: String,
    read_at: { type: Date, default: null },
}, { timestamps: true }));
exports.IntakeDocument = (0, plugins_1.model)('IntakeDocument', (() => {
    const s = new mongoose_1.Schema({
        uploaded_by: (0, plugins_1.oid)('User', true), file: { key: String, name: String, size: Number, hash: String, mime: String },
        status: { type: String, enum: ['queued', 'extracting', 'extracted', 'needs_manual_entry', 'failed', 'converted', 'discarded'], default: 'queued', index: true },
        text_source: { type: String, enum: ['pdf_text', 'ocr', 'none'], default: 'none' }, error: String,
        extraction: mongoose_1.Schema.Types.Mixed, matched_vendor_id: (0, plugins_1.oid)('Vendor'), invoice_id: (0, plugins_1.oid)('Invoice'),
        duplicate: mongoose_1.Schema.Types.Mixed,
    }, { timestamps: true });
    s.index({ organisation_id: 1, 'file.hash': 1 });
    return s;
})());
//# sourceMappingURL=system.js.map