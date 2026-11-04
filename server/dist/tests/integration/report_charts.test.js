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
// Checks that the real report endpoints return exactly the fields the dashboard and report charts read.
// Written against report.service.ts; needs a MongoDB like the other integration tests and has not been executed yet.
let app;
let w;
(0, node_test_1.before)(async () => {
    app = await (0, boot_1.boot)();
    w = await (0, world_1.makeWorld)(app.base);
    await (0, world_1.setupTaxAndRules)(w);
    const v = await (0, world_1.makeVendor)(w, 'Chart Data Co', (0, world_1.gstin)('33KKKKK9999K1Z'), '666666666666');
    await (0, world_1.approvedInvoice)(w, v, 'CHART-001', 200000);
});
(0, node_test_1.after)(async () => { await app.close(); });
const head = () => w.c(w.head1.token);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
(0, node_test_1.default)('dashboard: invoices_by_status entries have count and total_minor numbers', async () => {
    const d = (0, world_1.ok)(await head().get('/reports/dashboard'));
    const entries = Object.values(d.invoices_by_status);
    strict_1.default.ok(entries.length >= 1);
    for (const e of entries) {
        strict_1.default.ok(isNum(e.count));
        strict_1.default.ok(isNum(e.total_minor));
    }
    strict_1.default.ok(isNum(d.overdue.count));
});
(0, node_test_1.default)('aging: every bucket has count and total_minor', async () => {
    const r = (0, world_1.ok)(await head().get('/reports/aging'));
    strict_1.default.deepEqual(Object.keys(r.buckets), ['current', '1-30', '31-60', '61-90', '90+']);
    for (const b of Object.values(r.buckets)) {
        strict_1.default.ok(isNum(b.count));
        strict_1.default.ok(isNum(b.total_minor));
    }
});
(0, node_test_1.default)('cash-flow: each week has week, label and total_minor', async () => {
    const r = (0, world_1.ok)(await head().get('/reports/cash-flow'));
    strict_1.default.ok(r.length >= 2);
    strict_1.default.equal(r[0].week, 0);
    for (const row of r) {
        strict_1.default.ok(isNum(row.week));
        strict_1.default.equal(typeof row.label, 'string');
        strict_1.default.ok(isNum(row.total_minor));
    }
});
(0, node_test_1.default)('vendor-spend: rows are sorted by total and carry vendor_name', async () => {
    const r = (0, world_1.ok)(await head().get('/reports/vendor-spend'));
    strict_1.default.ok(r.length >= 1);
    strict_1.default.equal(r[0].vendor_name, 'Chart Data Co');
    strict_1.default.ok(isNum(r[0].total_minor));
});
(0, node_test_1.default)('approval-turnaround and tds rows carry the fields the charts read', async () => {
    for (const row of (0, world_1.ok)(await head().get('/reports/approval-turnaround'))) {
        strict_1.default.equal(typeof row.approver_name, 'string');
        strict_1.default.ok(isNum(row.avg_hours));
    }
    const t = (0, world_1.ok)(await head().get('/reports/tds'));
    for (const s of t.by_section) {
        strict_1.default.equal(typeof s.section, 'string');
        strict_1.default.ok(isNum(s.tds_minor));
    }
});
(0, node_test_1.default)('reconciliation status: lines map and payment counters exist', async () => {
    const r = (0, world_1.ok)(await head().get('/reports/reconciliation'));
    strict_1.default.equal(typeof r.lines, 'object');
    strict_1.default.ok(isNum(r.payments.reconciled.n));
    strict_1.default.ok(isNum(r.payments.unreconciled.n));
});
//# sourceMappingURL=report_charts.test.js.map