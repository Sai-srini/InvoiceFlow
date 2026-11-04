"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const statementParser_1 = require("../../domain/statementParser");
const parsers_1 = require("../../domain/extraction/parsers");
const validators_1 = require("../../lib/validators");
const profile = { header_row: 0, date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', reference_column: 'Chq/Ref No',
    amount_mode: 'separate', debit_column: 'Withdrawal Amt', credit_column: 'Deposit Amt', balance_column: 'Closing Balance', decimal_separator: '.', skip_footer_rows: 0 };
// Synthetic layout for TESTING THE PARSER ONLY. It is not a claim about any real bank's export format.
const csv = [
    'Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
    '13/10/2026,NEFT PMT-2026-000041 KAVERI,N284100001,"4,50,450.00",,"15,49,550.00"',
    '14/10/2026,UPI CUSTOMER RECEIPT,U1,,"25,000.00","15,74,550.00"',
    '14/10/2026,SERVICE CHARGE OCT,,118.00,,"15,74,432.00"',
].join('\n');
(0, node_test_1.default)('statement: dates are parsed strictly, DD/MM/YYYY is not confused with MM/DD', () => {
    strict_1.default.equal((0, statementParser_1.parseDate)('13/10/2026', 'DD/MM/YYYY')?.toISOString().slice(0, 10), '2026-10-13');
    strict_1.default.equal((0, statementParser_1.parseDate)('13/10/2026', 'MM/DD/YYYY'), null);
    strict_1.default.equal((0, statementParser_1.parseDate)('31/02/2026', 'DD/MM/YYYY'), null);
    strict_1.default.equal((0, statementParser_1.parseDate)('05-Oct-26', 'DD-MMM-YY')?.toISOString().slice(0, 10), '2026-10-05');
    strict_1.default.equal((0, statementParser_1.parseDate)('05/10/26', 'DD/MM/YYYY'), null); // wrong year width for the declared format
});
(0, node_test_1.default)('statement: amounts with Indian grouping, parentheses, Dr/Cr and decimal comma', () => {
    strict_1.default.equal((0, statementParser_1.parseAmountMinor)('4,50,450.00', '.'), 45045000);
    strict_1.default.equal((0, statementParser_1.parseAmountMinor)('(100.00)', '.'), -10000);
    strict_1.default.equal((0, statementParser_1.parseAmountMinor)('1,000.00 Dr', '.'), -100000);
    strict_1.default.equal((0, statementParser_1.parseAmountMinor)('1.234,56', ','), 123456);
    strict_1.default.equal((0, statementParser_1.parseAmountMinor)('', '.'), null);
    strict_1.default.throws(() => (0, statementParser_1.parseAmountMinor)('12x', '.'));
});
(0, node_test_1.default)('statement: debit and credit stay separate; mapping errors are explicit', () => {
    const r = (0, statementParser_1.parseStatementRows)((0, statementParser_1.csvToRows)(csv), profile);
    strict_1.default.equal(r.errors.length, 0);
    strict_1.default.equal(r.lines.length, 3);
    strict_1.default.deepEqual([r.lines[0].debit_minor, r.lines[0].credit_minor], [45045000, 0]);
    strict_1.default.deepEqual([r.lines[1].debit_minor, r.lines[1].credit_minor], [0, 2500000]);
    const bad = (0, statementParser_1.parseStatementRows)((0, statementParser_1.csvToRows)(csv), { ...profile, narration_column: 'Description' });
    strict_1.default.equal(bad.lines.length, 0);
    strict_1.default.match(bad.errors[0].message, /Column "Description"/);
    const badDate = (0, statementParser_1.parseStatementRows)((0, statementParser_1.csvToRows)(csv.replace('13/10/2026', '2026-13-45')), profile);
    strict_1.default.equal(badDate.errors.length, 1);
    strict_1.default.equal(badDate.lines.length, 2);
});
(0, node_test_1.default)('statement: signed and Dr/Cr amount layouts, semicolon delimiter', () => {
    const rows = (0, statementParser_1.csvToRows)('Date;Details;Amount\n13/10/2026;A;-500,00\n14/10/2026;B;250,00');
    strict_1.default.equal((0, statementParser_1.detectDelimiter)('Date;Details;Amount\n1;2;3'), ';');
    const r = (0, statementParser_1.parseStatementRows)(rows, { header_row: 0, date_column: 'Date', date_format: 'DD/MM/YYYY', narration_column: 'Details', amount_mode: 'signed', amount_column: 'Amount', decimal_separator: ',', skip_footer_rows: 0 });
    strict_1.default.deepEqual(r.lines.map((l) => [l.debit_minor, l.credit_minor]), [[50000, 0], [0, 25000]]);
    const dc = (0, statementParser_1.parseStatementRows)((0, statementParser_1.csvToRows)('Date,Narr,Amt,DrCr\n13/10/2026,x,10.00,DR\n13/10/2026,y,5.00,CR'), { header_row: 0, date_column: 'Date', date_format: 'DD/MM/YYYY', narration_column: 'Narr', amount_mode: 'amount_drcr', amount_column: 'Amt', drcr_column: 'DrCr', decimal_separator: '.', skip_footer_rows: 0 });
    strict_1.default.deepEqual(dc.lines.map((l) => [l.debit_minor, l.credit_minor]), [[1000, 0], [0, 500]]);
});
(0, node_test_1.default)('statement: re-importing the same rows gives identical fingerprints; identical rows in one file stay distinct', () => {
    const rows = (0, statementParser_1.csvToRows)(csv + '\n14/10/2026,SERVICE CHARGE OCT,,118.00,,"15,74,432.00"');
    const a = (0, statementParser_1.fingerprintLines)('acc1', (0, statementParser_1.parseStatementRows)(rows, profile).lines);
    const b = (0, statementParser_1.fingerprintLines)('acc1', (0, statementParser_1.parseStatementRows)(rows, profile).lines);
    strict_1.default.deepEqual(a.map((x) => x.fingerprint), b.map((x) => x.fingerprint));
    strict_1.default.equal(new Set(a.map((x) => x.fingerprint)).size, 4);
    strict_1.default.notEqual((0, statementParser_1.fingerprintLines)('acc2', (0, statementParser_1.parseStatementRows)(rows, profile).lines)[0].fingerprint, a[0].fingerprint);
});
(0, node_test_1.default)('statement: running balance is verified, descending statements are detected, tampering is caught', () => {
    const lines = (0, statementParser_1.parseStatementRows)((0, statementParser_1.csvToRows)(csv), profile).lines;
    const ok = (0, statementParser_1.checkBalances)(lines);
    strict_1.default.deepEqual([ok.checked, ok.ok, ok.order, ok.opening_minor, ok.closing_minor], [true, true, 'file', 2000000_00, 1574432_00]);
    strict_1.default.equal((0, statementParser_1.checkBalances)([...lines].reverse()).order, 'reversed');
    const tampered = lines.map((l, i) => (i === 1 ? { ...l, credit_minor: l.credit_minor + 100 } : l));
    const bad = (0, statementParser_1.checkBalances)(tampered);
    strict_1.default.equal(bad.ok, false);
    strict_1.default.equal(bad.mismatches[0].row_number, 3);
    strict_1.default.equal((0, statementParser_1.checkBalances)(lines.map((l) => ({ ...l, balance_minor: null }))).checked, false);
});
const g = (first14) => first14 + (0, validators_1.gstinCheckChar)(first14);
const VENDOR = g('33AAAAA0000A1Z'), BUYER = g('29BBBBB1111B1Z');
const invoiceText = `Kaveri Packaging Works
TAX INVOICE
Plot 14, Industrial Estate
GSTIN: ${VENDOR}
Invoice No: INV-2291
Invoice Date: 09/10/2026
Due Date: 24-Oct-2026
Bill To: Kaveri Foods Pvt Ltd
GSTIN: ${BUYER}
Corrugated carton 8,000 2,40,000.00
Shrink film 120 96,000.00
Taxable Value 3,85,000.00
CGST @9% 34,650.00
SGST @9% 34,650.00
Grand Total ₹ 4,54,300.00
Bank: HDFC IFSC HDFC0001234`;
(0, node_test_1.default)('extraction: reads fields from invoice text and validates them', () => {
    const r = (0, parsers_1.parseInvoiceText)(invoiceText);
    const f = r.fields;
    strict_1.default.equal(f.invoice_number.value, 'INV-2291');
    strict_1.default.equal(f.invoice_date.value, '2026-10-09');
    strict_1.default.equal(f.due_date.value, '2026-10-24');
    strict_1.default.equal(f.vendor_gstin.value, VENDOR);
    strict_1.default.equal(f.buyer_gstin.value, BUYER);
    strict_1.default.equal(f.vendor_pan.value, 'AAAAA0000A');
    strict_1.default.equal(f.ifsc.value, 'HDFC0001234');
    strict_1.default.deepEqual([f.subtotal_minor.value, f.cgst_minor.value, f.sgst_minor.value, f.total_minor.value], [38500000, 3465000, 3465000, 45430000]);
    strict_1.default.equal(f.currency.value, 'INR');
    strict_1.default.equal(r.checks.find((c) => c.key === 'totals')?.status, 'pass');
    strict_1.default.equal(r.checks.find((c) => c.key === 'Vendor gstin')?.status, 'pass');
});
(0, node_test_1.default)('extraction: arithmetic mismatch and bad check digit are flagged, missing fields stay empty', () => {
    const wrong = (0, parsers_1.parseInvoiceText)(invoiceText.replace('Grand Total ₹ 4,54,300.00', 'Grand Total ₹ 4,54,000.00'));
    strict_1.default.equal(wrong.checks.find((c) => c.key === 'totals')?.status, 'fail');
    strict_1.default.ok(wrong.fields.total_minor.flags.includes('arithmetic_mismatch'));
    const badG = (0, parsers_1.parseInvoiceText)(invoiceText.replace(VENDOR, VENDOR.slice(0, 14) + (VENDOR[14] === 'A' ? 'B' : 'A')));
    strict_1.default.ok(badG.fields.vendor_gstin.flags.includes('checksum_failed'));
    strict_1.default.ok(badG.fields.vendor_gstin.confidence < 0.9);
    const none = (0, parsers_1.parseInvoiceText)('hello world');
    strict_1.default.equal(none.fields.total_minor.value, null);
    strict_1.default.equal(none.fields.invoice_number.value, null);
    strict_1.default.equal((0, parsers_1.toIsoDate)('31/02/2026'), null);
    strict_1.default.equal((0, parsers_1.toIsoDate)('9 Oct 2026'), '2026-10-09');
});
//# sourceMappingURL=statement_extraction.test.js.map