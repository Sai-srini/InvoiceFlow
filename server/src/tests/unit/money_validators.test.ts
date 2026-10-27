import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMajorToMinor, formatMinor, applyBps } from '../../lib/money';
import { validateGstin, gstinCheckChar, isValidPan, isValidIfsc, normaliseInvoiceNumber } from '../../lib/validators';
import { toCsv } from '../../lib/csv';
import { encryptSecret, decryptSecret, maskAccount, last4 } from '../../lib/crypto';

test('money: parse and format in integer paise', () => {
  assert.equal(parseMajorToMinor('1,23,456.78'), 12345678);
  assert.equal(parseMajorToMinor('₹ 4,54,300'), 45430000);
  assert.equal(parseMajorToMinor('(250.00)'), -25000);
  assert.equal(parseMajorToMinor('10.5'), 1050);
  assert.throws(() => parseMajorToMinor('10.555'));
  assert.throws(() => parseMajorToMinor('abc'));
  assert.equal(formatMinor(45430000), '₹4,54,300.00');
  assert.equal(formatMinor(12345678), '₹1,23,456.78');
  assert.equal(formatMinor(-500, 'INR'), '-₹5.00');
  assert.equal(formatMinor(123456789, 'USD'), 'USD 1,234,567.89');
});
test('money: 0.1 + 0.2 style float errors cannot occur', () => {
  assert.equal(parseMajorToMinor('0.10') + parseMajorToMinor('0.20'), parseMajorToMinor('0.30'));
});
test('money: percentage rounding is half-up and integer', () => {
  assert.equal(applyBps(38500000, 100), 385000);       // 1% of ₹3,85,000
  assert.equal(applyBps(7322000, 100), 73220);
  assert.equal(applyBps(150, 5000), 75);               // 50% of 1.50
  assert.equal(applyBps(101, 5000), 51);               // 50.5 rounds up
});
test('validators: GSTIN structure, state code and check digit', () => {
  const ok = validateGstin('27AAPFU0939F1ZV');
  assert.deepEqual([ok.structure, ok.stateCode, ok.checksum, ok.pan], [true, true, true, 'AAPFU0939F']);
  assert.equal(validateGstin('27AAPFU0939F1ZA').checksum, false);
  assert.equal(validateGstin('99XYZ').structure, false);
  assert.equal(validateGstin('00AAPFU0939F1ZV').stateCode, false);
  assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V');
});
test('validators: PAN, IFSC, invoice number normalisation', () => {
  assert.ok(isValidPan('AAPFU0939F')); assert.ok(!isValidPan('AAPFU09391'));
  assert.ok(isValidIfsc('HDFC0001234')); assert.ok(!isValidIfsc('HDFC1001234'));
  assert.equal(normaliseInvoiceNumber('inv-2291 / A'), 'INV2291A');
});
test('csv: formula injection is neutralised', () => {
  const out = toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['plain'], ['has,comma']]);
  assert.match(out, /'=HYPERLINK/); assert.match(out, /'\+1/); assert.match(out, /"has,comma"/);
});
test('crypto: AES-GCM round trip, tamper detection, masking', () => {
  const c = encryptSecret('123456789012');
  assert.notEqual(c, '123456789012'); assert.equal(decryptSecret(c), '123456789012');
  assert.notEqual(encryptSecret('123456789012'), c); // random IV
  const parts = c.split(':'); parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptSecret(parts.join(':')));
  assert.equal(maskAccount(last4('123456789012')), '••••9012');
});
