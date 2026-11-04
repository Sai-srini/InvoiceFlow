"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idParam = exports.S = void 0;
const zod_1 = require("zod");
const oid = zod_1.z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const minor = zod_1.z.number().int().safe();
const date = zod_1.z.coerce.date();
exports.S = {
    login: zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(1).max(128) }),
    google: zod_1.z.object({ credential: zod_1.z.string().min(10) }),
    accept: zod_1.z.object({ token: zod_1.z.string().min(10), password: zod_1.z.string().min(1).max(128) }),
    changePassword: zod_1.z.object({ current_password: zod_1.z.string().min(1), new_password: zod_1.z.string().min(1).max(128) }),
    invite: zod_1.z.object({ email: zod_1.z.string().email(), full_name: zod_1.z.string().min(2).max(120), role_id: oid, department: zod_1.z.string().max(80).optional().nullable(), departments: zod_1.z.array(zod_1.z.string()).optional(), cost_centres: zod_1.z.array(zod_1.z.string()).optional(),
        approval_limit_minor: minor.min(0).optional(), approval_unlimited: zod_1.z.boolean().optional() }),
    userPatch: zod_1.z.object({ full_name: zod_1.z.string().min(2).max(120).optional(), role_id: oid.optional(), is_active: zod_1.z.boolean().optional(), department: zod_1.z.string().max(80).nullable().optional(), departments: zod_1.z.array(zod_1.z.string()).optional(),
        cost_centres: zod_1.z.array(zod_1.z.string()).optional(), approval_limit_minor: minor.min(0).optional(), approval_unlimited: zod_1.z.boolean().optional() }),
    role: zod_1.z.object({ name: zod_1.z.string().min(2).max(60), description: zod_1.z.string().max(300).optional(), permissions: zod_1.z.array(zod_1.z.string()) }),
    rolePatch: zod_1.z.object({ name: zod_1.z.string().min(2).max(60).optional(), description: zod_1.z.string().max(300).optional(), permissions: zod_1.z.array(zod_1.z.string()).optional() }),
    delegation: zod_1.z.object({ from_user: oid.optional(), to_user: oid, starts_at: date, ends_at: date, reason: zod_1.z.string().max(200).optional() }),
    sod: zod_1.z.object({ no_self_approval: zod_1.z.boolean(), run_preparer_cannot_release: zod_1.z.boolean(), proposer_cannot_approve: zod_1.z.boolean(), importer_cannot_approve_match: zod_1.z.boolean(),
        dual_release_threshold_minor: minor.min(0).nullable(), dual_approval_threshold_minor: minor.min(0).nullable() }).partial(),
    tax: zod_1.z.object({ gstin: zod_1.z.string().nullable().optional(), state_code: zod_1.z.string().nullable().optional(),
        tds_sections: zod_1.z.array(zod_1.z.object({ section: zod_1.z.string().min(1).max(20), description: zod_1.z.string().max(120).default(''), rate_bps: zod_1.z.number().int().min(0).max(10000), threshold_minor: minor.min(0).nullable().default(null) })).max(50) }),
    recon: zod_1.z.object({ tolerance_minor: minor.min(0).default(0), date_window_days: zod_1.z.number().int().min(0).max(30).default(5), classifiers: zod_1.z.array(zod_1.z.object({ pattern: zod_1.z.string().min(1).max(100), category: zod_1.z.string().min(1).max(60) })).max(50).default([]) }),
    bank: zod_1.z.object({ account_name: zod_1.z.string().min(2).max(120), account_number: zod_1.z.string(), ifsc: zod_1.z.string(), bank_name: zod_1.z.string().max(80).optional() }),
    vendor: zod_1.z.object({ name: zod_1.z.string().min(2).max(160), gstin: zod_1.z.string().optional().nullable(), pan: zod_1.z.string().optional().nullable(), category: zod_1.z.string().max(60).optional().nullable(), payment_terms_days: zod_1.z.number().int().min(0).max(365).optional(),
        tds_section: zod_1.z.string().max(20).optional().nullable(), contact_name: zod_1.z.string().max(120).optional(), contact_email: zod_1.z.string().email().optional(), contact_phone: zod_1.z.string().max(30).optional(), address: zod_1.z.string().max(300).optional(), bank: zod_1.z.any().optional() }),
    vendorPatch: zod_1.z.object({ name: zod_1.z.string().min(2).max(160), gstin: zod_1.z.string().nullable(), pan: zod_1.z.string().nullable(), category: zod_1.z.string().max(60).nullable(), payment_terms_days: zod_1.z.number().int().min(0).max(365), tds_section: zod_1.z.string().max(20).nullable(),
        status: zod_1.z.enum(['active', 'inactive']), contact_name: zod_1.z.string().max(120), contact_email: zod_1.z.union([zod_1.z.string().email(), zod_1.z.literal('')]), contact_phone: zod_1.z.string().max(30), address: zod_1.z.string().max(300) }).partial(),
    decision: zod_1.z.object({ note: zod_1.z.string().max(500).optional() }),
    bankChange: zod_1.z.object({ bank: zod_1.z.object({ account_name: zod_1.z.string().min(2).max(120), account_number: zod_1.z.string(), ifsc: zod_1.z.string(), bank_name: zod_1.z.string().max(80).optional() }), reason: zod_1.z.string().min(5).max(300) }),
    invoice: zod_1.z.object({ number: zod_1.z.string().min(1).max(60), vendor_id: oid, invoice_date: date, due_date: date, currency: zod_1.z.string().length(3).optional(), subtotal_minor: minor, cgst_minor: minor.optional(), sgst_minor: minor.optional(), igst_minor: minor.optional(),
        cess_minor: minor.optional(), round_off_minor: minor.optional(), total_minor: minor, department: zod_1.z.string().max(80).nullable().optional(), cost_centre: zod_1.z.string().max(80).nullable().optional(), description: zod_1.z.string().max(1000).optional(),
        line_items: zod_1.z.array(zod_1.z.object({ description: zod_1.z.string().max(300), amount_minor: minor, gl_code: zod_1.z.string().max(30).optional(), quantity: zod_1.z.number().optional(), hsn: zod_1.z.string().max(12).optional() })).max(200).optional(), duplicate_override_reason: zod_1.z.string().max(300).optional() }),
    comment: zod_1.z.object({ body: zod_1.z.string().min(1).max(4000), kind: zod_1.z.enum(['comment', 'query', 'response']).optional() }),
    reason: zod_1.z.object({ reason: zod_1.z.string().min(5).max(500) }),
    response: zod_1.z.object({ response: zod_1.z.string().max(1000).optional() }),
    decide: zod_1.z.object({ comment: zod_1.z.string().max(1000).optional() }),
    rule: zod_1.z.object({ name: zod_1.z.string().min(2).max(100), min_minor: minor.min(0), max_minor: minor.nullable().optional(), department: zod_1.z.string().nullable().optional(), cost_centre: zod_1.z.string().nullable().optional(), vendor_category: zod_1.z.string().nullable().optional(),
        approvers_required: zod_1.z.number().int().min(1).max(5), mode: zod_1.z.enum(['sequential', 'parallel']), role_ids: zod_1.z.array(oid).default([]), user_ids: zod_1.z.array(oid).default([]), escalation_hours: zod_1.z.number().int().min(1).max(720).default(24),
        priority: zod_1.z.number().int().min(0).max(1000).default(0), is_active: zod_1.z.boolean().default(true) }),
    run: zod_1.z.object({ invoice_ids: zod_1.z.array(oid).min(1).max(500), pay_date: date, notes: zod_1.z.string().max(300).optional() }),
    confirmPaid: zod_1.z.object({ bank_reference: zod_1.z.string().min(3).max(60), paid_date: date.optional() }),
    account: zod_1.z.object({ name: zod_1.z.string().min(2).max(100), bank_name: zod_1.z.string().max(80).optional(), account_last4: zod_1.z.string().regex(/^\d{4}$/).optional(), ifsc: zod_1.z.string().optional(), currency: zod_1.z.string().length(3).optional(), is_active: zod_1.z.boolean().optional() }),
    profile: zod_1.z.object({ bank_account_id: oid, name: zod_1.z.string().min(2).max(100), format: zod_1.z.enum(['csv', 'xlsx']).default('csv'), header_row: zod_1.z.number().int().min(0).max(100).default(0), date_column: zod_1.z.string().min(1), date_format: zod_1.z.string(),
        narration_column: zod_1.z.string().min(1), reference_column: zod_1.z.string().optional().nullable(), amount_mode: zod_1.z.enum(['separate', 'signed', 'amount_drcr']), debit_column: zod_1.z.string().optional().nullable(), credit_column: zod_1.z.string().optional().nullable(),
        amount_column: zod_1.z.string().optional().nullable(), drcr_column: zod_1.z.string().optional().nullable(), balance_column: zod_1.z.string().optional().nullable(), decimal_separator: zod_1.z.enum(['.', ',']).default('.'), skip_footer_rows: zod_1.z.number().int().min(0).max(50).default(0) }),
    manualMatch: zod_1.z.object({ allocations: zod_1.z.array(zod_1.z.object({ payment_id: oid, amount_minor: minor.positive() })).min(1).max(30) }),
    classify: zod_1.z.object({ category: zod_1.z.string().max(60).nullable().optional(), ignore: zod_1.z.boolean().optional() }),
    convert: zod_1.z.object({ vendor_id: oid.optional(), new_vendor: zod_1.z.any().optional(), number: zod_1.z.string().min(1).max(60), invoice_date: date, due_date: date, subtotal_minor: minor, cgst_minor: minor.optional(), sgst_minor: minor.optional(), igst_minor: minor.optional(),
        cess_minor: minor.optional(), round_off_minor: minor.optional(), total_minor: minor, department: zod_1.z.string().nullable().optional(), cost_centre: zod_1.z.string().nullable().optional(), description: zod_1.z.string().max(1000).optional(),
        line_items: zod_1.z.array(zod_1.z.object({ description: zod_1.z.string(), amount_minor: minor, gl_code: zod_1.z.string().optional(), quantity: zod_1.z.number().optional(), hsn: zod_1.z.string().optional() })).optional(), duplicate_override_reason: zod_1.z.string().max(300).optional(), submit: zod_1.z.boolean().optional() }),
};
const idParam = (v) => { if (!/^[a-f0-9]{24}$/i.test(String(v))) {
    const { badRequest } = require('../lib/errors');
    throw badRequest('Invalid id');
} return String(v); };
exports.idParam = idParam;
//# sourceMappingURL=schemas.js.map