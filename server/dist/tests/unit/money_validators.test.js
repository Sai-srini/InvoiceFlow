"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const money_1 = require("../../lib/money");
const validators_1 = require("../../lib/validators");
const csv_1 = require("../../lib/csv");
const crypto_1 = require("../../lib/crypto");
(0, node_test_1.default)('money: parse and format in integer paise', () => {
    strict_1.default.equal((0, money_1.parseMajorToMinor)('1,23,456.78'), 12345678);
    strict_1.default.equal((0, money_1.parseMajorToMinor)('₹ 4,54,300'), 45430000);
    strict_1.default.equal((0, money_1.parseMajorToMinor)('(250.00)'), -25000);
    strict_1.default.equal((0, money_1.parseMajorToMinor)('10.5'), 1050);
    strict_1.default.throws(() => (0, money_1.parseMajorToMinor)('10.555'));
    strict_1.default.throws(() => (0, money_1.parseMajorToMinor)('abc'));
    strict_1.default.equal((0, money_1.formatMinor)(45430000), '₹4,54,300.00');
    strict_1.default.equal((0, money_1.formatMinor)(12345678), '₹1,23,456.78');
    strict_1.default.equal((0, money_1.formatMinor)(-500, 'INR'), '-₹5.00');
    strict_1.default.equal((0, money_1.formatMinor)(123456789, 'USD'), 'USD 1,234,567.89');
});
(0, node_test_1.default)('money: 0.1 + 0.2 style float errors cannot occur', () => {
    strict_1.default.equal((0, money_1.parseMajorToMinor)('0.10') + (0, money_1.parseMajorToMinor)('0.20'), (0, money_1.parseMajorToMinor)('0.30'));
});
(0, node_test_1.default)('money: percentage rounding is half-up and integer', () => {
    strict_1.default.equal((0, money_1.applyBps)(38500000, 100), 385000); // 1% of ₹3,85,000
    strict_1.default.equal((0, money_1.applyBps)(7322000, 100), 73220);
    strict_1.default.equal((0, money_1.applyBps)(150, 5000), 75); // 50% of 1.50
    strict_1.default.equal((0, money_1.applyBps)(101, 5000), 51); // 50.5 rounds up
});
(0, node_test_1.default)('validators: GSTIN structure, state code and check digit', () => {
    const ok = (0, validators_1.validateGstin)('27AAPFU0939F1ZV');
    strict_1.default.deepEqual([ok.structure, ok.stateCode, ok.checksum, ok.pan], [true, true, true, 'AAPFU0939F']);
    strict_1.default.equal((0, validators_1.validateGstin)('27AAPFU0939F1ZA').checksum, false);
    strict_1.default.equal((0, validators_1.validateGstin)('99XYZ').structure, false);
    strict_1.default.equal((0, validators_1.validateGstin)('00AAPFU0939F1ZV').stateCode, false);
    strict_1.default.equal((0, validators_1.gstinCheckChar)('27AAPFU0939F1Z'), 'V');
});
(0, node_test_1.default)('validators: PAN, IFSC, invoice number normalisation', () => {
    strict_1.default.ok((0, validators_1.isValidPan)('AAPFU0939F'));
    strict_1.default.ok(!(0, validators_1.isValidPan)('AAPFU09391'));
    strict_1.default.ok((0, validators_1.isValidIfsc)('HDFC0001234'));
    strict_1.default.ok(!(0, validators_1.isValidIfsc)('HDFC1001234'));
    strict_1.default.equal((0, validators_1.normaliseInvoiceNumber)('inv-2291 / A'), 'INV2291A');
});
(0, node_test_1.default)('csv: formula injection is neutralised', () => {
    const out = (0, csv_1.toCsv)(['a'], [['=HYPERLINK("x")'], ['+1'], ['plain'], ['has,comma']]);
    strict_1.default.match(out, /'=HYPERLINK/);
    strict_1.default.match(out, /'\+1/);
    strict_1.default.match(out, /"has,comma"/);
});
(0, node_test_1.default)('crypto: AES-GCM round trip, tamper detection, masking', () => {
    const c = (0, crypto_1.encryptSecret)('123456789012');
    strict_1.default.notEqual(c, '123456789012');
    strict_1.default.equal((0, crypto_1.decryptSecret)(c), '123456789012');
    strict_1.default.notEqual((0, crypto_1.encryptSecret)('123456789012'), c); // random IV
    const parts = c.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    strict_1.default.throws(() => (0, crypto_1.decryptSecret)(parts.join(':')));
    strict_1.default.equal((0, crypto_1.maskAccount)((0, crypto_1.last4)('123456789012')), '••••9012');
});
//# sourceMappingURL=money_validators.test.js.map