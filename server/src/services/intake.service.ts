import { Request } from 'express';
import { IntakeDocument, Vendor, Invoice } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, notFound } from '../lib/errors';
import { validateFileMagicBytes } from './storage/fileValidator';
import { storage } from './storage';
import { env } from '../config/env';
import { enqueue } from '../queues';
import { extractPdfText } from '../domain/extraction/pdfText';
import { ocrImage } from '../domain/extraction/ocr';
import { parseInvoiceText } from '../domain/extraction/parsers';
import { normaliseInvoiceNumber } from '../lib/validators';
import { paginate } from '../lib/paginate';
import { createInvoice, InvoiceInput } from './invoice.service';
import { proposeVendor } from './vendor.service';
import { submitInvoice } from './approval.service';
import { parseMajorToMinor } from '../lib/money';

/** Upload: validated by file signature, hashed, stored privately, then extracted in the background. Never auto-submitted. */
export async function uploadForIntake(actor: Actor, file: { buffer: Buffer; name: string }) {
  if (file.buffer.length > env.MAX_FILE_SIZE) throw badRequest(`File is larger than ${Math.round(env.MAX_FILE_SIZE / 1048576)} MB.`);
  const v = validateFileMagicBytes(file.buffer);
  if (!v.valid) throw badRequest(v.error || 'Only PDF, PNG and JPEG files are accepted.', undefined, 'INVALID_FILE');
  const saved = await storage().save(file.buffer, file.name, v.detectedMime!, `${actor.orgId}/intake`);
  const dupDoc = await IntakeDocument.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash, status: { $ne: 'discarded' } }).lean();
  const dupInv = await Invoice.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash }).lean();
  if (dupDoc || dupInv) { await storage().remove(saved.key); throw conflict('This exact file was already uploaded.', 'DUPLICATE_FILE', { intake_id: dupDoc ? String((dupDoc as any)._id) : undefined, invoice_id: dupInv ? String((dupInv as any)._id) : undefined }); }
  const doc: any = await withTxn(async (session) => {
    const [d]: any = await IntakeDocument.create([{ organisation_id: actor.orgId, uploaded_by: actor.userId, file: { key: saved.key, name: saved.originalName, size: saved.fileSize, hash: saved.fileHash, mime: saved.mimeType }, status: 'queued' }], { session });
    await writeAudit(actor, { action: 'intake.uploaded', entity_type: 'IntakeDocument', entity_id: d._id, new_values: { hash: saved.fileHash, size: saved.fileSize, mime: saved.mimeType } }, session);
    return d;
  });
  await enqueue('intake.extract', { orgId: actor.orgId, id: String(doc._id) });
  return intakeDto(await IntakeDocument.findOne({ _id: doc._id, organisation_id: actor.orgId }).lean());
}

export const intakeDto = (d: any) => ({ id: String(d._id), status: d.status, file_name: d.file?.name, file_size: d.file?.size, mime: d.file?.mime, text_source: d.text_source, error: d.error,
  extraction: d.extraction || null, matched_vendor_id: d.matched_vendor_id ? String(d.matched_vendor_id) : null, invoice_id: d.invoice_id ? String(d.invoice_id) : null, duplicate: d.duplicate || null, createdAt: d.createdAt });

/** Background job: read text (PDF text layer or OCR), parse deterministically, validate, check duplicates. */
export async function extractDocument(orgId: string, id: string) {
  const doc: any = await IntakeDocument.findOne({ _id: id, organisation_id: orgId });
  if (!doc || !['queued', 'failed', 'needs_manual_entry'].includes(doc.status)) return;
  doc.status = 'extracting'; await doc.save();
  try {
    const buf = await storage().read(doc.file.key);
    let text = ''; let source: 'pdf_text' | 'ocr' | 'none' = 'none';
    if (doc.file.mime === 'application/pdf') {
      const r = await extractPdfText(buf); text = r.text; source = 'pdf_text';
      if (text.replace(/\s/g, '').length < 40) { doc.status = 'needs_manual_entry'; doc.text_source = 'none'; doc.error = 'This PDF has no readable text layer (it is probably a scan). OCR of scanned PDFs is not supported yet: enter the details by hand.'; await doc.save(); return; }
    } else {
      try { text = await ocrImage(buf); source = 'ocr'; }
      catch (e: any) { doc.status = 'needs_manual_entry'; doc.text_source = 'none'; doc.error = e.code === 'NOT_CONFIGURED' ? e.message : `OCR failed: ${e.message}`; await doc.save(); return; }
    }
    const ex = parseInvoiceText(text);
    let vendor: any = null;
    const g = ex.fields.vendor_gstin.value;
    if (g) vendor = await Vendor.findOne({ organisation_id: orgId, gstin: g }).lean();
    let duplicate: any = null;
    const num = ex.fields.invoice_number.value;
    if (vendor && num) {
      const same: any = await Invoice.findOne({ organisation_id: orgId, vendor_id: vendor._id, number_norm: normaliseInvoiceNumber(num) }).lean();
      if (same) duplicate = { level: 'block', message: `Invoice ${same.number} already exists for this vendor.`, invoice_id: String(same._id) };
      else if (ex.fields.total_minor.value) {
        const sim: any = await Invoice.findOne({ organisation_id: orgId, vendor_id: vendor._id, total_minor: ex.fields.total_minor.value }).lean();
        if (sim) duplicate = { level: 'warn', message: `Invoice ${sim.number} has the same vendor and amount.`, invoice_id: String(sim._id) };
      }
    }
    doc.extraction = ex; doc.text_source = source; doc.matched_vendor_id = vendor?._id; doc.duplicate = duplicate; doc.status = 'extracted'; doc.error = undefined;
    await doc.save();
  } catch (e: any) { doc.status = 'failed'; doc.error = `Could not read this document: ${e.message}`; await doc.save(); }
}

export async function listIntake(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId };
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  const page = await paginate(IntakeDocument.find(f).sort({ createdAt: -1 }), IntakeDocument.countDocuments(f), req);
  return { ...page, data: page.data.map(intakeDto) };
}
export async function getIntake(actor: Actor, id: string) {
  const d = await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean(); if (!d) throw notFound('Intake document');
  return intakeDto(d);
}
export async function downloadIntakeFile(actor: Actor, id: string) {
  const d: any = await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean(); if (!d) throw notFound('Intake document');
  return { buffer: await storage().read(d.file.key), mime: d.file.mime, name: d.file.name };
}
export async function discardIntake(actor: Actor, id: string) {
  const d: any = await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }); if (!d) throw notFound('Intake document');
  if (d.status === 'converted') throw conflict('This document already became an invoice.', 'INVALID_STATE');
  await withTxn(async (s) => { d.status = 'discarded'; await d.save({ session: s }); await writeAudit(actor, { action: 'intake.discarded', entity_type: 'IntakeDocument', entity_id: id }, s); });
  return { id, status: 'discarded' };
}
export async function retryIntake(actor: Actor, id: string) {
  const d: any = await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }); if (!d) throw notFound('Intake document');
  if (!['failed', 'needs_manual_entry'].includes(d.status)) throw conflict('Only failed documents can be retried.', 'INVALID_STATE');
  d.status = 'queued'; await d.save(); await enqueue('intake.extract', { orgId: actor.orgId, id });
  return intakeDto(await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean());
}

/** The reviewer's verified values become a DRAFT invoice (optionally submitted). Unknown vendors become a vendor PROPOSAL, never an active vendor. */
export async function convertToInvoice(actor: Actor, id: string, input: Omit<InvoiceInput, 'file' | 'intake_id' | 'vendor_id'> & { vendor_id?: string; new_vendor?: any; submit?: boolean }) {
  const d: any = await IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId });
  if (!d) throw notFound('Intake document');
  if (!['extracted', 'needs_manual_entry', 'failed'].includes(d.status)) throw conflict(`A document that is ${d.status} cannot be converted.`, 'INVALID_STATE');
  let vendorId = input.vendor_id;
  if (!vendorId) {
    if (!input.new_vendor) throw badRequest('Choose a vendor or provide new vendor details.');
    if (!actor.permissions.has('vendor.propose')) throw badRequest('You cannot propose new vendors; ask someone who can.', undefined, 'MISSING_PERMISSION');
    vendorId = (await proposeVendor(actor, input.new_vendor)).id;
  }
  const inv = await createInvoice(actor, { ...input, vendor_id: vendorId, intake_id: id, file: { key: d.file.key, name: d.file.name, size: d.file.size, hash: d.file.hash, mime: d.file.mime } } as InvoiceInput);
  d.status = 'converted'; d.invoice_id = inv._id; await d.save();
  await withTxn((s) => writeAudit(actor, { action: 'intake.converted', entity_type: 'IntakeDocument', entity_id: id, metadata: { invoice_id: inv._id } }, s));
  if (input.submit) return { invoice: await submitInvoice(actor, String(inv._id)), submitted: true };
  const { invoiceDto } = require('./invoice.service');
  return { invoice: invoiceDto(inv), submitted: false };
}
export { parseMajorToMinor };
