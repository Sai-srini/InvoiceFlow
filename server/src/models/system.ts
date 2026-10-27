import { Schema } from 'mongoose';
import { model, oid, appendOnlyPlugin } from './plugins';

const auditSchema = new Schema({
  seq: { type: Number, required: true }, prev_hash: { type: String, required: true }, hash: { type: String, required: true },
  actor_id: { type: Schema.Types.ObjectId, default: null }, action: { type: String, required: true },
  entity_type: String, entity_id: String, old_values: Schema.Types.Mixed, new_values: Schema.Types.Mixed, metadata: Schema.Types.Mixed,
  ip: String, user_agent: String, at: { type: Date, required: true },
}, { minimize: false }); // keep {} exactly as hashed
auditSchema.index({ organisation_id: 1, seq: 1 }, { unique: true });
auditSchema.index({ organisation_id: 1, entity_type: 1, entity_id: 1 });
auditSchema.plugin(appendOnlyPlugin);
export const AuditLog = model('AuditLog', auditSchema);

export const Notification = model('Notification', new Schema({
  user_id: oid('User', true), kind: String, title: String, body: String, entity_type: String, entity_id: String,
  email_state: { type: String, enum: ['not_applicable', 'pending', 'sent', 'undelivered', 'failed'], default: 'not_applicable' }, email_error: String,
  read_at: { type: Date, default: null },
}, { timestamps: true }));

export const IntakeDocument = model('IntakeDocument', (() => {
  const s = new Schema({
    uploaded_by: oid('User', true), file: { key: String, name: String, size: Number, hash: String, mime: String },
    status: { type: String, enum: ['queued', 'extracting', 'extracted', 'needs_manual_entry', 'failed', 'converted', 'discarded'], default: 'queued', index: true },
    text_source: { type: String, enum: ['pdf_text', 'ocr', 'none'], default: 'none' }, error: String,
    extraction: Schema.Types.Mixed, matched_vendor_id: oid('Vendor'), invoice_id: oid('Invoice'),
    duplicate: Schema.Types.Mixed,
  }, { timestamps: true });
  s.index({ organisation_id: 1, 'file.hash': 1 });
  return s;
})());
