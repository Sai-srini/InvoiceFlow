import test from 'node:test';
import assert from 'node:assert/strict';
import { csvToRows, parseStatementRows, parseDate, parseAmountMinor, fingerprintLines, checkBalances, detectDelimiter, StatementProfileCfg } from '../../domain/statementParser';
import { parseInvoiceText, toIsoDate } from '../../domain/extraction/parsers';
import { gstinCheckChar } from '../../lib/validators';

const profile: StatementProfileCfg = { header_row: 0, date_column: 'Txn Date', date_format: 'DD/MM/YYYY', narration_column: 'Narration', reference_column: 'Chq/Ref No',
  amount_mode: 'separate', debit_column: 'Withdrawal Amt', credit_column: 'Deposit Amt', balance_column: 'Closing Balance', decimal_separator: '.', skip_footer_rows: 0 };
// Synthetic layout for TESTING THE PARSER ONLY. It is not a claim about any real bank's export format.
const csv = [
  'Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
  '13/10/2026,NEFT PMT-2026-000041 KAVERI,N284100001,"4,50,450.00",,"15,49,550.00"',
  '14/10/2026,UPI CUSTOMER RECEIPT,U1,,"25,000.00","15,74,550.00"',
  '14/10/2026,SERVICE CHARGE OCT,,118.00,,"15,74,432.00"',
].join('\n');

test('statement: dates are parsed strictly, DD/MM/YYYY is not confused with MM/DD', () => {
  assert.equal(parseDate('13/10/2026', 'DD/MM/YYYY')?.toISOString().slice(0, 10), '2026-10-13');
  assert.equal(parseDate('13/10/2026', 'MM/DD/YYYY'), null);
  assert.equal(parseDate('31/02/2026', 'DD/MM/YYYY'), null);
  assert.equal(parseDate('05-Oct-26', 'DD-MMM-YY')?.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(parseDate('05/10/26', 'DD/MM/YYYY'), null); // wrong year width for the declared format
});
test('statement: amounts with Indian grouping, parentheses, Dr/Cr and decimal comma', () => {
  assert.equal(parseAmountMinor('4,50,450.00', '.'), 45045000);
  assert.equal(parseAmountMinor('(100.00)', '.'), -10000);
  assert.equal(parseAmountMinor('1,000.00 Dr', '.'), -100000);
  assert.equal(parseAmountMinor('1.234,56', ','), 123456);
  assert.equal(parseAmountMinor('', '.'), null);
  assert.throws(() => parseAmountMinor('12x', '.'));
});
test('statement: debit and credit stay separate; mapping errors are explicit', () => {
  const r = parseStatementRows(csvToRows(csv), profile);
  assert.equal(r.errors.length, 0); assert.equal(r.lines.length, 3);
  assert.deepEqual([r.lines[0].debit_minor, r.lines[0].credit_minor], [45045000, 0]);
  assert.deepEqual([r.lines[1].debit_minor, r.lines[1].credit_minor], [0, 2500000]);
  const bad = parseStatementRows(csvToRows(csv), { ...profile, narration_column: 'Description' });
  assert.equal(bad.lines.length, 0); assert.match(bad.errors[0].message, /Column "Description"/);
  const badDate = parseStatementRows(csvToRows(csv.replace('13/10/2026', '2026-13-45')), profile);
  assert.equal(badDate.errors.length, 1); assert.equal(badDate.lines.length, 2);
});
test('statement: signed and Dr/Cr amount layouts, semicolon delimiter', () => {
  const rows = csvToRows('Date;Details;Amount\n13/10/2026;A;-500,00\n14/10/2026;B;250,00');
  assert.equal(detectDelimiter('Date;Details;Amount\n1;2;3'), ';');
  const r = parseStatementRows(rows, { header_row: 0, date_column: 'Date', date_format: 'DD/MM/YYYY', narration_column: 'Details', amount_mode: 'signed', amount_column: 'Amount', decimal_separator: ',', skip_footer_rows: 0 });
  assert.deepEqual(r.lines.map((l) => [l.debit_minor, l.credit_minor]), [[50000, 0], [0, 25000]]);
  const dc = parseStatementRows(csvToRows('Date,Narr,Amt,DrCr\n13/10/2026,x,10.00,DR\n13/10/2026,y,5.00,CR'), { header_row: 0, date_column: 'Date', date_format: 'DD/MM/YYYY', narration_column: 'Narr', amount_mode: 'amount_drcr', amount_column: 'Amt', drcr_column: 'DrCr', decimal_separator: '.', skip_footer_rows: 0 });
  assert.deepEqual(dc.lines.map((l) => [l.debit_minor, l.credit_minor]), [[1000, 0], [0, 500]]);
});
test('statement: re-importing the same rows gives identical fingerprints; identical rows in one file stay distinct', () => {
  const rows = csvToRows(csv + '\n14/10/2026,SERVICE CHARGE OCT,,118.00,,"15,74,432.00"');
  const a = fingerprintLines('acc1', parseStatementRows(rows, profile).lines);
  const b = fingerprintLines('acc1', parseStatementRows(rows, profile).lines);
  assert.deepEqual(a.map((x) => x.fingerprint), b.map((x) => x.fingerprint));
  assert.equal(new Set(a.map((x) => x.fingerprint)).size, 4);
  assert.notEqual(fingerprintLines('acc2', parseStatementRows(rows, profile).lines)[0].fingerprint, a[0].fingerprint);
});
test('statement: running balance is verified, descending statements are detected, tampering is caught', () => {
  const lines = parseStatementRows(csvToRows(csv), profile).lines;
  const ok = checkBalances(lines);
  assert.deepEqual([ok.checked, ok.ok, ok.order, ok.opening_minor, ok.closing_minor], [true, true, 'file', 2000000_00, 1574432_00 ]);
  assert.equal(checkBalances([...lines].reverse()).order, 'reversed');
  const tampered = lines.map((l, i) => (i === 1 ? { ...l, credit_minor: l.credit_minor + 100 } : l));
  const bad = checkBalances(tampered); assert.equal(bad.ok, false); assert.equal(bad.mismatches[0].row_number, 3);
  assert.equal(checkBalances(lines.map((l) => ({ ...l, balance_minor: null }))).checked, false);
});

const g = (first14: string) => first14 + gstinCheckChar(first14);
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
test('extraction: reads fields from invoice text and validates them', () => {
  const r = parseInvoiceText(invoiceText); const f = r.fields;
  assert.equal(f.invoice_number.value, 'INV-2291');
  assert.equal(f.invoice_date.value, '2026-10-09'); assert.equal(f.due_date.value, '2026-10-24');
  assert.equal(f.vendor_gstin.value, VENDOR); assert.equal(f.buyer_gstin.value, BUYER);
  assert.equal(f.vendor_pan.value, 'AAAAA0000A'); assert.equal(f.ifsc.value, 'HDFC0001234');
  assert.deepEqual([f.subtotal_minor.value, f.cgst_minor.value, f.sgst_minor.value, f.total_minor.value], [38500000, 3465000, 3465000, 45430000]);
  assert.equal(f.currency.value, 'INR');
  assert.equal(r.checks.find((c) => c.key === 'totals')?.status, 'pass');
  assert.equal(r.checks.find((c) => c.key === 'Vendor gstin')?.status, 'pass');
});
test('extraction: arithmetic mismatch and bad check digit are flagged, missing fields stay empty', () => {
  const wrong = parseInvoiceText(invoiceText.replace('Grand Total ₹ 4,54,300.00', 'Grand Total ₹ 4,54,000.00'));
  assert.equal(wrong.checks.find((c) => c.key === 'totals')?.status, 'fail');
  assert.ok(wrong.fields.total_minor.flags.includes('arithmetic_mismatch'));
  const badG = parseInvoiceText(invoiceText.replace(VENDOR, VENDOR.slice(0, 14) + (VENDOR[14] === 'A' ? 'B' : 'A')));
  assert.ok(badG.fields.vendor_gstin.flags.includes('checksum_failed')); assert.ok(badG.fields.vendor_gstin.confidence < 0.9);
  const none = parseInvoiceText('hello world');
  assert.equal(none.fields.total_minor.value, null); assert.equal(none.fields.invoice_number.value, null);
  assert.equal(toIsoDate('31/02/2026'), null); assert.equal(toIsoDate('9 Oct 2026'), '2026-10-09');
});
