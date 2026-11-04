"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceBody = exports.VENDOR_GSTIN = exports.ok = exports.gstin = exports.PW = void 0;
exports.login = login;
exports.addUser = addUser;
exports.makeWorld = makeWorld;
exports.makeVendor = makeVendor;
exports.setupTaxAndRules = setupTaxAndRules;
exports.approvedInvoice = approvedInvoice;
const boot_1 = require("./boot");
const validators_1 = require("../../lib/validators");
exports.PW = 'Str0ng!Passw0rd';
const gstin = (first14) => first14 + (0, validators_1.gstinCheckChar)(first14);
exports.gstin = gstin;
const ok = (r, status = 200) => { if (r.status !== status)
    throw new Error(`Expected ${status} but got ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
exports.ok = ok;
async function login(base, email, password = exports.PW) {
    const r = await (0, boot_1.client)(base).post('/auth/login', { email, password });
    return { ...r, token: r.body?.access_token, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function addUser(base, adminToken, roleId, email, name, extra = {}) {
    const inv = await (0, boot_1.client)(base, adminToken).post('/users/invite', { email, full_name: name, role_id: roleId, ...extra });
    (0, exports.ok)(inv, 201);
    const token = new URL(inv.body.link).searchParams.get('token');
    const acc = await (0, boot_1.client)(base).post('/auth/accept-invite', { token, password: exports.PW });
    (0, exports.ok)(acc);
    return { id: inv.body.user.id, token: acc.body.access_token, email };
}
/** Builds an organisation with one user per role template, all through the real API. */
async function makeWorld(base) {
    const { createOrganisation } = await import('../../services/org.service.js');
    const { org } = await createOrganisation({ name: 'Kaveri Foods Pvt Ltd', adminEmail: 'admin@kaveri.test', adminName: 'Asha Admin', adminPassword: exports.PW });
    const adminLogin = await login(base, 'admin@kaveri.test');
    (0, exports.ok)(adminLogin);
    const admin = { token: adminLogin.token };
    const roleList = (0, exports.ok)(await (0, boot_1.client)(base, admin.token).get('/roles'));
    const roles = Object.fromEntries(roleList.map((r) => [r.name, r.id]));
    const lakh = (n) => n * 100000 * 100;
    const accounts = await addUser(base, admin.token, roles['Accounts Team'], 'rohan.accounts@kaveri.test', 'Rohan Iyer');
    const approver1 = await addUser(base, admin.token, roles['Approver'], 'priya.approver@kaveri.test', 'Priya Nair', { approval_limit_minor: lakh(5) });
    const approver2 = await addUser(base, admin.token, roles['Approver'], 'vikram.approver@kaveri.test', 'Vikram Shah', { approval_limit_minor: lakh(20) });
    const head1 = await addUser(base, admin.token, roles['Finance Head'], 'anil.head@kaveri.test', 'Anil Kapoor', { approval_unlimited: true });
    const head2 = await addUser(base, admin.token, roles['Finance Head'], 'meera.head@kaveri.test', 'Meera Rao', { approval_unlimited: true });
    const requester = await addUser(base, admin.token, roles['Requester'], 'sam.requester@kaveri.test', 'Sam Dutta');
    const auditor = await addUser(base, admin.token, roles['Auditor'], 'ila.auditor@kaveri.test', 'Ila Menon');
    return { base, orgId: String(org._id), admin, roles, accounts, approver1, approver2, head1, head2, requester, auditor, c: (t) => (0, boot_1.client)(base, t) };
}
exports.VENDOR_GSTIN = (0, exports.gstin)('33AAAAA0000A1Z');
/** An active vendor with bank details and the TEST1 TDS section. */
async function makeVendor(w, name = 'Kaveri Packaging Works', g = exports.VENDOR_GSTIN, account = '123456789012') {
    const v = (0, exports.ok)(await w.c(w.accounts.token).post('/vendors', { name, gstin: g, category: 'Packaging', payment_terms_days: 15, contact_email: 'ar@vendor.test',
        bank: { account_name: name, account_number: account, ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' } }), 201);
    (0, exports.ok)(await w.c(w.head1.token).post(`/vendors/${v.id}/approve`, {}));
    (0, exports.ok)(await w.c(w.head1.token).patch(`/vendors/${v.id}`, { tds_section: 'TEST1' }));
    return v.id;
}
async function setupTaxAndRules(w) {
    (0, exports.ok)(await w.c(w.head1.token).put('/settings/tax', { gstin: null, state_code: '33', tds_sections: [{ section: 'TEST1', description: 'test section', rate_bps: 100, threshold_minor: null }] }));
    (0, exports.ok)(await w.c(w.head1.token).post('/approval-rules', { name: 'Small', min_minor: 0, max_minor: 40000000, approvers_required: 1, mode: 'sequential', priority: 1 }), 201);
    (0, exports.ok)(await w.c(w.head1.token).post('/approval-rules', { name: 'Large', min_minor: 40000000, max_minor: null, approvers_required: 2, mode: 'sequential', priority: 1 }), 201);
}
const invoiceBody = (vendor_id, number, subtotal, extra = {}) => {
    const gst = Math.round(subtotal * 0.09);
    return { number, vendor_id, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: subtotal, cgst_minor: gst, sgst_minor: gst, total_minor: subtotal + 2 * gst, department: 'Packaging', ...extra };
};
exports.invoiceBody = invoiceBody;
/** Creates, submits and fully approves an invoice. Returns its id. */
async function approvedInvoice(w, vendor, number, subtotal) {
    const inv = (0, exports.ok)(await w.c(w.accounts.token).post('/invoices', (0, exports.invoiceBody)(vendor, number, subtotal)), 201);
    const sub = (0, exports.ok)(await w.c(w.accounts.token).post(`/invoices/${inv.id}/submit`));
    let detail = (0, exports.ok)(await w.c(w.accounts.token).get(`/invoices/${inv.id}`));
    const tokens = { [w.approver1.id]: w.approver1.token, [w.approver2.id]: w.approver2.token, [w.head1.id]: w.head1.token, [w.head2.id]: w.head2.token };
    for (const s of [...detail.approval_steps].sort((a, b) => a.step_order - b.step_order))
        (0, exports.ok)(await w.c(tokens[s.approver_id]).post(`/invoices/${inv.id}/approve`, {}));
    detail = (0, exports.ok)(await w.c(w.accounts.token).get(`/invoices/${inv.id}`));
    if (detail.status !== 'approved')
        throw new Error(`invoice ${number} should be approved, is ${detail.status} (${sub.status})`);
    return inv.id;
}
//# sourceMappingURL=world.js.map