"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importStar(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boot_1 = require("../helpers/boot");
const world_1 = require("../helpers/world");
// NOTE: written for the vendor-management upgrade. Like the other integration tests it needs a MongoDB the test
// helper can boot; it has not been executed in the environment where it was written.
let app;
let w;
(0, node_test_1.before)(async () => { app = await (0, boot_1.boot)(); w = await (0, world_1.makeWorld)(app.base); await (0, world_1.setupTaxAndRules)(w); });
(0, node_test_1.after)(async () => { await app.close(); });
const acc = () => w.c(w.accounts.token);
const head = () => w.c(w.head1.token);
(0, node_test_1.default)('vendor list returns status counts for the filter chips, ignoring the active filter', async () => {
    await (0, world_1.makeVendor)(w, 'Counts Active Co', (0, world_1.gstin)('33CCCCC1111C1Z'), '111111111111');
    (0, world_1.ok)(await acc().post('/vendors', { name: 'Counts Pending Co', gstin: (0, world_1.gstin)('29DDDDD2222D1Z') }), 201);
    const r = (0, world_1.ok)(await head().get('/vendors?status=pending_approval'));
    strict_1.default.ok(r.counts.active >= 1);
    strict_1.default.ok(r.counts.pending_approval >= 1);
    strict_1.default.ok(r.data.every((v) => v.status === 'pending_approval'));
});
(0, node_test_1.default)('vendor detail includes invoice statistics', async () => {
    const id = await (0, world_1.makeVendor)(w, 'Stats Co', (0, world_1.gstin)('33EEEEE3333E1Z'), '222222222222');
    strict_1.default.deepEqual((0, world_1.ok)(await head().get(`/vendors/${id}`)).stats.invoice_count, 0);
    await (0, world_1.approvedInvoice)(w, id, 'STAT-001', 100000);
    const d = (0, world_1.ok)(await head().get(`/vendors/${id}`));
    strict_1.default.equal(d.stats.invoice_count, 1);
    strict_1.default.ok(d.stats.open_minor > 0);
    strict_1.default.equal(d.stats.paid_minor, 0);
});
(0, node_test_1.default)('deactivate and reactivate: audited, blocked while approved invoices wait for payment', async () => {
    const id = await (0, world_1.makeVendor)(w, 'Toggle Co', (0, world_1.gstin)('33FFFFF4444F1Z'), '333333333333');
    await (0, world_1.approvedInvoice)(w, id, 'TOG-001', 100000);
    const blocked = await head().patch(`/vendors/${id}`, { status: 'inactive' });
    strict_1.default.equal(blocked.status, 409);
    strict_1.default.equal(blocked.body.code, 'OPEN_INVOICES');
    const free = await (0, world_1.makeVendor)(w, 'Toggle Free Co', (0, world_1.gstin)('33GGGGG5555G1Z'), '444444444444');
    strict_1.default.equal((0, world_1.ok)(await head().patch(`/vendors/${free}`, { status: 'inactive' })).status, 'inactive');
    strict_1.default.equal((0, world_1.ok)(await head().patch(`/vendors/${free}`, { status: 'active' })).status, 'active');
});
(0, node_test_1.default)('only an approved vendor can be switched active/inactive; pending ones must be approved or rejected', async () => {
    const v = (0, world_1.ok)(await acc().post('/vendors', { name: 'Still Pending Co', gstin: (0, world_1.gstin)('27HHHHH6666H1Z') }), 201);
    const r = await head().patch(`/vendors/${v.id}`, { status: 'active' });
    strict_1.default.equal(r.status, 409);
    strict_1.default.equal(r.body.code, 'BAD_STATE');
});
(0, node_test_1.default)('accounts staff can edit contact details but not identity, tax or terms', async () => {
    const id = await (0, world_1.makeVendor)(w, 'Edit Co', (0, world_1.gstin)('33IIIII7777I1Z'), '555555555555');
    const role = (0, world_1.ok)(await w.c(w.admin.token).post('/roles', { name: 'Vendor Editor', permissions: ['vendor.view', 'vendor.propose'] }), 201);
    strict_1.default.ok(role.id);
    strict_1.default.equal((0, world_1.ok)(await acc().patch(`/vendors/${id}`, { contact_phone: '+91 90000 00000', contact_email: '' })).contact_phone, '+91 90000 00000');
    strict_1.default.equal((await acc().patch(`/vendors/${id}`, { payment_terms_days: 90 })).status, 403);
    strict_1.default.equal((0, world_1.ok)(await head().patch(`/vendors/${id}`, { payment_terms_days: 90 })).payment_terms_days, 90);
});
(0, node_test_1.default)('a rejected vendor keeps its rejection reason', async () => {
    const v = (0, world_1.ok)(await acc().post('/vendors', { name: 'Reject Me Co', gstin: (0, world_1.gstin)('29JJJJJ8888J1Z') }), 201);
    strict_1.default.equal((await head().post(`/vendors/${v.id}/reject`, {})).status, 400);
    (0, world_1.ok)(await head().post(`/vendors/${v.id}/reject`, { note: 'GSTIN does not match legal name' }));
    strict_1.default.equal((0, world_1.ok)(await head().get(`/vendors/${v.id}`)).rejection_reason, 'GSTIN does not match legal name');
});
//# sourceMappingURL=vendor_management.test.js.map