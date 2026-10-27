import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLines, subsetSums, vendorScore, MLine, MPay, DEFAULT_MATCH_CONFIG } from '../../domain/matching';

const d = (s: string) => new Date(s + 'T00:00:00Z');
const line = (id: string, date: string, narr: string, debit: number, o: Partial<MLine> = {}): MLine => ({ id, date: d(date), narration: narr, debit_minor: debit, credit_minor: 0, ...o });
const pay = (id: string, ref: string, net: number, vendor: string, o: Partial<MPay> = {}): MPay => ({ id, reference: ref, net_minor: net, reconciled_minor: 0, vendor_name: vendor, released_at: d('2026-10-15'), ...o });
const cfg = DEFAULT_MATCH_CONFIG;

test('matching: reference on the bank line gives a safe auto match', () => {
  const p = matchLines([line('l1', '2026-10-16', 'NEFT PMT-2026-000041 KAVERI PACKAGING', 450450_00)], [pay('p1', 'PMT-2026-000041', 450450_00, 'Kaveri Packaging Works')], cfg);
  assert.equal(p.length, 1); const m = p[0] as any;
  assert.equal(m.kind, 'match'); assert.equal(m.method, 'reference'); assert.deepEqual(m.allocations, [{ line_id: 'l1', payment_id: 'p1', amount_minor: 450450_00 }]);
});
test('matching: credits are never matched to vendor payments', () => {
  const l = line('c1', '2026-10-16', 'NEFT PMT-2026-000041', 0, { credit_minor: 450450_00 });
  assert.deepEqual(matchLines([l], [pay('p1', 'PMT-2026-000041', 450450_00, 'Kaveri')], cfg), []);
});
test('matching: amount + vendor name matches only when unique; ambiguity goes to exceptions', () => {
  const pays = [pay('p1', 'PMT-1', 85668_00, 'Marina Logistics Pvt Ltd'), pay('p2', 'PMT-2', 85668_00, 'Delta Cold Chain LLP')];
  const one = matchLines([line('l1', '2026-10-17', 'IMPS MARINA LOGISTICS', 85668_00)], pays, cfg)[0] as any;
  assert.equal(one.kind, 'match'); assert.equal(one.method, 'amount_vendor'); assert.equal(one.allocations[0].payment_id, 'p1');
  const amb = matchLines([line('l2', '2026-10-17', 'IMPS TRANSFER', 85668_00)], pays.map((x) => ({ ...x, released_at: d('2026-10-16') })), cfg)[0] as any;
  assert.equal(amb.kind, 'exception'); assert.equal(amb.reason, 'ambiguous'); assert.equal(amb.candidates.length, 2);
});
test('matching: date-window only match is a suggestion, not an automatic match', () => {
  const s = matchLines([line('l1', '2026-10-17', 'UPI PAYMENT', 58401_00)], [pay('p1', 'PMT-9', 58401_00, 'Delta Cold Chain LLP')], cfg)[0] as any;
  assert.equal(s.kind, 'suggestion'); assert.equal(s.method, 'amount_date'); assert.ok(s.confidence < 0.85);
  const far = matchLines([line('l1', '2026-12-30', 'UPI PAYMENT', 58401_00)], [pay('p1', 'PMT-9', 58401_00, 'Delta Cold Chain LLP')], cfg)[0] as any;
  assert.equal(far.kind, 'exception'); assert.equal(far.reason, 'no_candidate');
});
test('matching: one bank debit covering a whole batch of payments', () => {
  const pays = ['a', 'b', 'c'].map((x, i) => pay('p' + x, 'PMT-' + x, [100000_00, 250000_00, 33333_00][i], 'V' + x, { run_id: 'run1' }));
  const s = matchLines([line('l1', '2026-10-16', 'BULK PAYOUT', 350000_00)], pays, cfg)[0] as any;
  assert.equal(s.kind, 'suggestion'); assert.equal(s.method, 'batch_sum'); assert.deepEqual(s.allocations.map((a: any) => a.payment_id).sort(), ['pa', 'pb']);
});
test('matching: split payments (two bank lines for one payment) and over-payment', () => {
  const p = pay('p1', 'PMT-77', 300000_00, 'Southern Spice Traders');
  const out = matchLines([line('l1', '2026-10-16', 'PMT-77 PART 1', 100000_00), line('l2', '2026-10-17', 'PMT-77 PART 2', 200000_00)], [p], cfg) as any[];
  assert.equal(out[0].method, 'reference_partial'); assert.equal(out[1].method, 'reference');
  const over = matchLines([line('l3', '2026-10-17', 'PMT-77', 999999_00)], [p], cfg)[0] as any;
  assert.equal(over.kind, 'exception'); assert.equal(over.reason, 'amount_exceeds_payment');
});
test('matching: a payment cannot be used twice in one run; classifiers take charges out of matching', () => {
  const p = pay('p1', 'PMT-5', 1000_00, 'Acme Traders');
  const out = matchLines([line('l1', '2026-10-16', 'PMT-5', 1000_00), line('l2', '2026-10-16', 'PMT-5 again', 1000_00)], [p], cfg) as any[];
  assert.equal(out[0].kind, 'match'); assert.notEqual(out[1].kind, 'match');
  const cl = matchLines([line('l3', '2026-10-16', 'SERVICE CHARGE OCT', 118_00)], [], { ...cfg, classifiers: [{ pattern: 'SERVICE CHARGE', category: 'bank_charges' }] })[0] as any;
  assert.deepEqual([cl.kind, cl.category], ['classified', 'bank_charges']);
});
test('matching: tolerance is honoured and helpers behave', () => {
  const p = pay('p1', 'PMT-1', 1000_00, 'Acme Traders');
  const t = matchLines([line('l1', '2026-10-16', 'PMT-1', 999_50)], [p], { ...cfg, tolerance_minor: 100 })[0] as any;
  assert.equal(t.kind, 'match');
  assert.equal(vendorScore('Marina Logistics Pvt Ltd', 'IMPS MARINALOGISTICS 1234'), 1);
  assert.equal(vendorScore('Ab Co', 'ANYTHING'), 0);
  assert.equal(subsetSums([{ id: 'a', amount: 5 }, { id: 'b', amount: 7 }, { id: 'c', amount: 12 }], 12, 0).length, 1 + 0 > 0 ? 1 : 0); // {a,b}; single-item subset not counted
});
