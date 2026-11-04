"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const matching_1 = require("../../domain/matching");
const d = (s) => new Date(s + 'T00:00:00Z');
const line = (id, date, narr, debit, o = {}) => ({ id, date: d(date), narration: narr, debit_minor: debit, credit_minor: 0, ...o });
const pay = (id, ref, net, vendor, o = {}) => ({ id, reference: ref, net_minor: net, reconciled_minor: 0, vendor_name: vendor, released_at: d('2026-10-15'), ...o });
const cfg = matching_1.DEFAULT_MATCH_CONFIG;
(0, node_test_1.default)('matching: reference on the bank line gives a safe auto match', () => {
    const p = (0, matching_1.matchLines)([line('l1', '2026-10-16', 'NEFT PMT-2026-000041 KAVERI PACKAGING', 450450_00)], [pay('p1', 'PMT-2026-000041', 450450_00, 'Kaveri Packaging Works')], cfg);
    strict_1.default.equal(p.length, 1);
    const m = p[0];
    strict_1.default.equal(m.kind, 'match');
    strict_1.default.equal(m.method, 'reference');
    strict_1.default.deepEqual(m.allocations, [{ line_id: 'l1', payment_id: 'p1', amount_minor: 450450_00 }]);
});
(0, node_test_1.default)('matching: credits are never matched to vendor payments', () => {
    const l = line('c1', '2026-10-16', 'NEFT PMT-2026-000041', 0, { credit_minor: 450450_00 });
    strict_1.default.deepEqual((0, matching_1.matchLines)([l], [pay('p1', 'PMT-2026-000041', 450450_00, 'Kaveri')], cfg), []);
});
(0, node_test_1.default)('matching: amount + vendor name matches only when unique; ambiguity goes to exceptions', () => {
    const pays = [pay('p1', 'PMT-1', 85668_00, 'Marina Logistics Pvt Ltd'), pay('p2', 'PMT-2', 85668_00, 'Delta Cold Chain LLP')];
    const one = (0, matching_1.matchLines)([line('l1', '2026-10-17', 'IMPS MARINA LOGISTICS', 85668_00)], pays, cfg)[0];
    strict_1.default.equal(one.kind, 'match');
    strict_1.default.equal(one.method, 'amount_vendor');
    strict_1.default.equal(one.allocations[0].payment_id, 'p1');
    const amb = (0, matching_1.matchLines)([line('l2', '2026-10-17', 'IMPS TRANSFER', 85668_00)], pays.map((x) => ({ ...x, released_at: d('2026-10-16') })), cfg)[0];
    strict_1.default.equal(amb.kind, 'exception');
    strict_1.default.equal(amb.reason, 'ambiguous');
    strict_1.default.equal(amb.candidates.length, 2);
});
(0, node_test_1.default)('matching: date-window only match is a suggestion, not an automatic match', () => {
    const s = (0, matching_1.matchLines)([line('l1', '2026-10-17', 'UPI PAYMENT', 58401_00)], [pay('p1', 'PMT-9', 58401_00, 'Delta Cold Chain LLP')], cfg)[0];
    strict_1.default.equal(s.kind, 'suggestion');
    strict_1.default.equal(s.method, 'amount_date');
    strict_1.default.ok(s.confidence < 0.85);
    const far = (0, matching_1.matchLines)([line('l1', '2026-12-30', 'UPI PAYMENT', 58401_00)], [pay('p1', 'PMT-9', 58401_00, 'Delta Cold Chain LLP')], cfg)[0];
    strict_1.default.equal(far.kind, 'exception');
    strict_1.default.equal(far.reason, 'no_candidate');
});
(0, node_test_1.default)('matching: one bank debit covering a whole batch of payments', () => {
    const pays = ['a', 'b', 'c'].map((x, i) => pay('p' + x, 'PMT-' + x, [100000_00, 250000_00, 33333_00][i], 'V' + x, { run_id: 'run1' }));
    const s = (0, matching_1.matchLines)([line('l1', '2026-10-16', 'BULK PAYOUT', 350000_00)], pays, cfg)[0];
    strict_1.default.equal(s.kind, 'suggestion');
    strict_1.default.equal(s.method, 'batch_sum');
    strict_1.default.deepEqual(s.allocations.map((a) => a.payment_id).sort(), ['pa', 'pb']);
});
(0, node_test_1.default)('matching: split payments (two bank lines for one payment) and over-payment', () => {
    const p = pay('p1', 'PMT-77', 300000_00, 'Southern Spice Traders');
    const out = (0, matching_1.matchLines)([line('l1', '2026-10-16', 'PMT-77 PART 1', 100000_00), line('l2', '2026-10-17', 'PMT-77 PART 2', 200000_00)], [p], cfg);
    strict_1.default.equal(out[0].method, 'reference_partial');
    strict_1.default.equal(out[1].method, 'reference');
    const over = (0, matching_1.matchLines)([line('l3', '2026-10-17', 'PMT-77', 999999_00)], [p], cfg)[0];
    strict_1.default.equal(over.kind, 'exception');
    strict_1.default.equal(over.reason, 'amount_exceeds_payment');
});
(0, node_test_1.default)('matching: a payment cannot be used twice in one run; classifiers take charges out of matching', () => {
    const p = pay('p1', 'PMT-5', 1000_00, 'Acme Traders');
    const out = (0, matching_1.matchLines)([line('l1', '2026-10-16', 'PMT-5', 1000_00), line('l2', '2026-10-16', 'PMT-5 again', 1000_00)], [p], cfg);
    strict_1.default.equal(out[0].kind, 'match');
    strict_1.default.notEqual(out[1].kind, 'match');
    const cl = (0, matching_1.matchLines)([line('l3', '2026-10-16', 'SERVICE CHARGE OCT', 118_00)], [], { ...cfg, classifiers: [{ pattern: 'SERVICE CHARGE', category: 'bank_charges' }] })[0];
    strict_1.default.deepEqual([cl.kind, cl.category], ['classified', 'bank_charges']);
});
(0, node_test_1.default)('matching: tolerance is honoured and helpers behave', () => {
    const p = pay('p1', 'PMT-1', 1000_00, 'Acme Traders');
    const t = (0, matching_1.matchLines)([line('l1', '2026-10-16', 'PMT-1', 999_50)], [p], { ...cfg, tolerance_minor: 100 })[0];
    strict_1.default.equal(t.kind, 'match');
    strict_1.default.equal((0, matching_1.vendorScore)('Marina Logistics Pvt Ltd', 'IMPS MARINALOGISTICS 1234'), 1);
    strict_1.default.equal((0, matching_1.vendorScore)('Ab Co', 'ANYTHING'), 0);
    strict_1.default.equal((0, matching_1.subsetSums)([{ id: 'a', amount: 5 }, { id: 'b', amount: 7 }, { id: 'c', amount: 12 }], 12, 0).length, 1 + 0 > 0 ? 1 : 0); // {a,b}; single-item subset not counted
});
//# sourceMappingURL=matching.test.js.map