"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMajorToMinor = exports.intakeDto = void 0;
exports.uploadForIntake = uploadForIntake;
exports.extractDocument = extractDocument;
exports.listIntake = listIntake;
exports.getIntake = getIntake;
exports.downloadIntakeFile = downloadIntakeFile;
exports.discardIntake = discardIntake;
exports.retryIntake = retryIntake;
exports.convertToInvoice = convertToInvoice;
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const fileValidator_1 = require("./storage/fileValidator");
const storage_1 = require("./storage");
const env_1 = require("../config/env");
const queues_1 = require("../queues");
const pdfText_1 = require("../domain/extraction/pdfText");
const ocr_1 = require("../domain/extraction/ocr");
const parsers_1 = require("../domain/extraction/parsers");
const validators_1 = require("../lib/validators");
const paginate_1 = require("../lib/paginate");
const invoice_service_1 = require("./invoice.service");
const vendor_service_1 = require("./vendor.service");
const approval_service_1 = require("./approval.service");
const money_1 = require("../lib/money");
Object.defineProperty(exports, "parseMajorToMinor", { enumerable: true, get: function () { return money_1.parseMajorToMinor; } });
/** Upload: validated by file signature, hashed, stored privately, then extracted in the background. Never auto-submitted. */
async function uploadForIntake(actor, file) {
    if (file.buffer.length > env_1.env.MAX_FILE_SIZE)
        throw (0, errors_1.badRequest)(`File is larger than ${Math.round(env_1.env.MAX_FILE_SIZE / 1048576)} MB.`);
    const v = (0, fileValidator_1.validateFileMagicBytes)(file.buffer);
    if (!v.valid)
        throw (0, errors_1.badRequest)(v.error || 'Only PDF, PNG and JPEG files are accepted.', undefined, 'INVALID_FILE');
    const saved = await (0, storage_1.storage)().save(file.buffer, file.name, v.detectedMime, `${actor.orgId}/intake`);
    const dupDoc = await models_1.IntakeDocument.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash, status: { $ne: 'discarded' } }).lean();
    const dupInv = await models_1.Invoice.findOne({ organisation_id: actor.orgId, 'file.hash': saved.fileHash }).lean();
    if (dupDoc || dupInv) {
        await (0, storage_1.storage)().remove(saved.key);
        throw (0, errors_1.conflict)('This exact file was already uploaded.', 'DUPLICATE_FILE', { intake_id: dupDoc ? String(dupDoc._id) : undefined, invoice_id: dupInv ? String(dupInv._id) : undefined });
    }
    const doc = await (0, txn_1.withTxn)(async (session) => {
        const [d] = await models_1.IntakeDocument.create([{ organisation_id: actor.orgId, uploaded_by: actor.userId, file: { key: saved.key, name: saved.originalName, size: saved.fileSize, hash: saved.fileHash, mime: saved.mimeType }, status: 'queued' }], { session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'intake.uploaded', entity_type: 'IntakeDocument', entity_id: d._id, new_values: { hash: saved.fileHash, size: saved.fileSize, mime: saved.mimeType } }, session);
        return d;
    });
    await (0, queues_1.enqueue)('intake.extract', { orgId: actor.orgId, id: String(doc._id) });
    return (0, exports.intakeDto)(await models_1.IntakeDocument.findOne({ _id: doc._id, organisation_id: actor.orgId }).lean());
}
const intakeDto = (d) => ({ id: String(d._id), status: d.status, file_name: d.file?.name, file_size: d.file?.size, mime: d.file?.mime, text_source: d.text_source, error: d.error,
    extraction: d.extraction || null, matched_vendor_id: d.matched_vendor_id ? String(d.matched_vendor_id) : null, invoice_id: d.invoice_id ? String(d.invoice_id) : null, duplicate: d.duplicate || null, createdAt: d.createdAt });
exports.intakeDto = intakeDto;
/** Background job: read text (PDF text layer or OCR), parse deterministically, validate, check duplicates. */
async function extractDocument(orgId, id) {
    const doc = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: orgId });
    if (!doc || !['queued', 'failed', 'needs_manual_entry'].includes(doc.status))
        return;
    doc.status = 'extracting';
    await doc.save();
    try {
        const buf = await (0, storage_1.storage)().read(doc.file.key);
        let text = '';
        let source = 'none';
        if (doc.file.mime === 'application/pdf') {
            const r = await (0, pdfText_1.extractPdfText)(buf);
            text = r.text;
            source = 'pdf_text';
            if (text.replace(/\s/g, '').length < 40) {
                doc.status = 'needs_manual_entry';
                doc.text_source = 'none';
                doc.error = 'This PDF has no readable text layer (it is probably a scan). OCR of scanned PDFs is not supported yet: enter the details by hand.';
                await doc.save();
                return;
            }
        }
        else {
            try {
                text = await (0, ocr_1.ocrImage)(buf);
                source = 'ocr';
            }
            catch (e) {
                doc.status = 'needs_manual_entry';
                doc.text_source = 'none';
                doc.error = e.code === 'NOT_CONFIGURED' ? e.message : `OCR failed: ${e.message}`;
                await doc.save();
                return;
            }
        }
        const ex = (0, parsers_1.parseInvoiceText)(text);
        let vendor = null;
        const g = ex.fields.vendor_gstin.value;
        if (g)
            vendor = await models_1.Vendor.findOne({ organisation_id: orgId, gstin: g }).lean();
        let duplicate = null;
        const num = ex.fields.invoice_number.value;
        if (vendor && num) {
            const same = await models_1.Invoice.findOne({ organisation_id: orgId, vendor_id: vendor._id, number_norm: (0, validators_1.normaliseInvoiceNumber)(num) }).lean();
            if (same)
                duplicate = { level: 'block', message: `Invoice ${same.number} already exists for this vendor.`, invoice_id: String(same._id) };
            else if (ex.fields.total_minor.value) {
                const sim = await models_1.Invoice.findOne({ organisation_id: orgId, vendor_id: vendor._id, total_minor: ex.fields.total_minor.value }).lean();
                if (sim)
                    duplicate = { level: 'warn', message: `Invoice ${sim.number} has the same vendor and amount.`, invoice_id: String(sim._id) };
            }
        }
        doc.extraction = ex;
        doc.text_source = source;
        doc.matched_vendor_id = vendor?._id;
        doc.duplicate = duplicate;
        doc.status = 'extracted';
        doc.error = undefined;
        await doc.save();
    }
    catch (e) {
        doc.status = 'failed';
        doc.error = `Could not read this document: ${e.message}`;
        await doc.save();
    }
}
async function listIntake(actor, req) {
    const f = { organisation_id: actor.orgId };
    if (req.query.status)
        f.status = { $in: String(req.query.status).split(',') };
    const page = await (0, paginate_1.paginate)(models_1.IntakeDocument.find(f).sort({ createdAt: -1 }), models_1.IntakeDocument.countDocuments(f), req);
    return { ...page, data: page.data.map(exports.intakeDto) };
}
async function getIntake(actor, id) {
    const d = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!d)
        throw (0, errors_1.notFound)('Intake document');
    return (0, exports.intakeDto)(d);
}
async function downloadIntakeFile(actor, id) {
    const d = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!d)
        throw (0, errors_1.notFound)('Intake document');
    return { buffer: await (0, storage_1.storage)().read(d.file.key), mime: d.file.mime, name: d.file.name };
}
async function discardIntake(actor, id) {
    const d = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId });
    if (!d)
        throw (0, errors_1.notFound)('Intake document');
    if (d.status === 'converted')
        throw (0, errors_1.conflict)('This document already became an invoice.', 'INVALID_STATE');
    await (0, txn_1.withTxn)(async (s) => { d.status = 'discarded'; await d.save({ session: s }); await (0, audit_service_1.writeAudit)(actor, { action: 'intake.discarded', entity_type: 'IntakeDocument', entity_id: id }, s); });
    return { id, status: 'discarded' };
}
async function retryIntake(actor, id) {
    const d = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId });
    if (!d)
        throw (0, errors_1.notFound)('Intake document');
    if (!['failed', 'needs_manual_entry'].includes(d.status))
        throw (0, errors_1.conflict)('Only failed documents can be retried.', 'INVALID_STATE');
    d.status = 'queued';
    await d.save();
    await (0, queues_1.enqueue)('intake.extract', { orgId: actor.orgId, id });
    return (0, exports.intakeDto)(await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId }).lean());
}
/** The reviewer's verified values become a DRAFT invoice (optionally submitted). Unknown vendors become a vendor PROPOSAL, never an active vendor. */
async function convertToInvoice(actor, id, input) {
    const d = await models_1.IntakeDocument.findOne({ _id: id, organisation_id: actor.orgId });
    if (!d)
        throw (0, errors_1.notFound)('Intake document');
    if (!['extracted', 'needs_manual_entry', 'failed'].includes(d.status))
        throw (0, errors_1.conflict)(`A document that is ${d.status} cannot be converted.`, 'INVALID_STATE');
    let vendorId = input.vendor_id;
    if (!vendorId) {
        if (!input.new_vendor)
            throw (0, errors_1.badRequest)('Choose a vendor or provide new vendor details.');
        if (!actor.permissions.has('vendor.propose'))
            throw (0, errors_1.badRequest)('You cannot propose new vendors; ask someone who can.', undefined, 'MISSING_PERMISSION');
        vendorId = (await (0, vendor_service_1.proposeVendor)(actor, input.new_vendor)).id;
    }
    const inv = await (0, invoice_service_1.createInvoice)(actor, { ...input, vendor_id: vendorId, intake_id: id, file: { key: d.file.key, name: d.file.name, size: d.file.size, hash: d.file.hash, mime: d.file.mime } });
    d.status = 'converted';
    d.invoice_id = inv._id;
    await d.save();
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'intake.converted', entity_type: 'IntakeDocument', entity_id: id, metadata: { invoice_id: inv._id } }, s));
    if (input.submit)
        return { invoice: await (0, approval_service_1.submitInvoice)(actor, String(inv._id)), submitted: true };
    const { invoiceDto } = require('./invoice.service');
    return { invoice: invoiceDto(inv), submitted: false };
}
//# sourceMappingURL=intake.service.js.map