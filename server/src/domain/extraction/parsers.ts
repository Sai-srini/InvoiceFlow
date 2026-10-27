import { PAN_RE, IFSC_RE, validateGstin, isValidPan } from '../../lib/validators';
import { parseMajorToMinor } from '../../lib/money';
import { checkTotals } from '../tax';

export interface Field<T> { value: T | null; confidence: number; source: string | null; flags: string[]; }
export interface Check { key: string; status: 'pass' | 'warn' | 'fail' | 'info'; message: string; }
export interface Extraction {
  fields: {
    invoice_number: Field<string>; invoice_date: Field<string>; due_date: Field<string>; vendor_name: Field<string>;
    vendor_gstin: Field<string>; buyer_gstin: Field<string>; vendor_pan: Field<string>; ifsc: Field<string>; currency: Field<string>;
    subtotal_minor: Field<number>; cgst_minor: Field<number>; sgst_minor: Field<number>; igst_minor: Field<number>;
    cess_minor: Field<number>; round_off_minor: Field<number>; total_minor: Field<number>;
  };
  checks: Check[];
}

const empty = <T>(): Field<T> => ({ value: null, confidence: 0, source: null, flags: ['not_found'] });
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const AMOUNT_RE = /(\(?-?)\s*(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\)?/g;
const DATE_SRC = '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}[\\s\\-]*[A-Za-z]{3,9}[,\\s\\-]+\\d{2,4}|\\d{4}-\\d{2}-\\d{2})';

export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[\s\-]*([A-Za-z]{3})[A-Za-z]*[,\s\-]+(\d{2}|\d{4})$/))) {
    d = +m[1]; mo = MONTHS.indexOf(m[2].toUpperCase()) + 1; y = +m[3]; if (!mo) return null;
  } else return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function amountsIn(line: string): { minor: number }[] {
  const out: { minor: number }[] = [];
  const stripped = line.replace(/\d+(\.\d+)?\s*%/g, ' '); // drop percentages like "9%"
  for (const m of stripped.matchAll(AMOUNT_RE)) {
    try { const v = parseMajorToMinor(m[2]); out.push({ minor: (m[1] && (m[1].includes('(') || m[1].includes('-'))) ? -v : v }); } catch { /* skip */ }
  }
  return out;
}

function labelled(lines: string[], include: RegExp[], exclude?: RegExp): { minor: number; source: string } | null {
  for (const re of include) {
    let found: { minor: number; source: string } | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i]) || (exclude && exclude.test(lines[i]))) continue;
      let am = amountsIn(lines[i].replace(re, ' '));
      if (!am.length && lines[i + 1]) am = amountsIn(lines[i + 1]);
      if (am.length) found = { minor: am[am.length - 1].minor, source: lines[i] };
    }
    if (found) return found;
  }
  return null;
}

const money = (r: { minor: number; source: string } | null, conf: number): Field<number> =>
  r ? { value: r.minor, confidence: conf, source: r.source, flags: [] } : empty<number>();

export function parseInvoiceText(text: string): Extraction {
  const lines = (text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const upper = lines.map((l) => l.toUpperCase());
  const checks: Check[] = [];
  const fields: Extraction['fields'] = {
    invoice_number: empty(), invoice_date: empty(), due_date: empty(), vendor_name: empty(), vendor_gstin: empty(), buyer_gstin: empty(),
    vendor_pan: empty(), ifsc: empty(), currency: empty(), subtotal_minor: empty(), cgst_minor: empty(), sgst_minor: empty(),
    igst_minor: empty(), cess_minor: empty(), round_off_minor: empty(), total_minor: empty(),
  };

  // ---- GSTINs
  const gstRe = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
  const buyerKw = /(BUYER|BILL(?:ED)?\s*TO|SHIP(?:PED)?\s*TO|CUSTOMER|RECIPIENT|CONSIGNEE|RECEIVER)/;
  const found: { g: string; buyer: boolean; src: string }[] = [];
  upper.forEach((l, i) => {
    for (const m of l.matchAll(gstRe)) {
      const ctx = (upper[i - 1] || '') + ' ' + l.slice(0, m.index);
      found.push({ g: m[0], buyer: buyerKw.test(ctx.slice(-90)), src: lines[i] });
    }
  });
  const distinct = found.filter((f, i) => found.findIndex((x) => x.g === f.g) === i);
  let vendor = distinct.find((f) => !f.buyer) || (distinct.length >= 2 ? distinct[0] : undefined);
  let buyer = distinct.find((f) => f.buyer && f !== vendor) || (distinct.length >= 2 ? distinct.find((f) => f !== vendor) : undefined);
  const gstField = (f?: { g: string; src: string }, label = ''): Field<string> => {
    if (!f) return empty<string>();
    const v = validateGstin(f.g);
    const flags: string[] = [];
    if (!v.stateCode) flags.push('invalid_state_code');
    if (!v.checksum) flags.push('checksum_failed');
    checks.push({ key: `${label}gstin`, status: v.structure && v.stateCode && v.checksum ? 'pass' : 'warn',
      message: v.checksum ? `${label}GSTIN ${f.g} has a valid format and check digit.` : `${label}GSTIN ${f.g} has a valid structure but FAILS the check-digit test. Verify it on the invoice.` });
    return { value: f.g, confidence: flags.length ? 0.5 : 0.95, source: f.src, flags };
  };
  fields.vendor_gstin = gstField(vendor, 'Vendor ');
  fields.buyer_gstin = gstField(buyer, 'Buyer ');
  if (!vendor) checks.push({ key: 'vendor_gstin', status: 'warn', message: 'No GSTIN found on the document.' });

  // ---- PAN / IFSC
  const vg = fields.vendor_gstin.value ? validateGstin(fields.vendor_gstin.value) : null;
  if (vg?.pan) fields.vendor_pan = { value: vg.pan, confidence: 0.9, source: 'derived from vendor GSTIN', flags: [] };
  else {
    for (let i = 0; i < upper.length && !fields.vendor_pan.value; i++) {
      const m = upper[i].match(/\bPAN\b[^A-Z0-9]*([A-Z]{5}\d{4}[A-Z])\b/);
      if (m && isValidPan(m[1])) fields.vendor_pan = { value: m[1], confidence: 0.9, source: lines[i], flags: [] };
    }
  }
  for (let i = 0; i < upper.length && !fields.ifsc.value; i++) {
    const m = upper[i].match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/);
    if (m && IFSC_RE.test(m[0])) fields.ifsc = { value: m[0], confidence: 0.9, source: lines[i], flags: [] };
  }

  // ---- invoice number
  const numRe = /(?:tax\s*invoice|invoice|inv|bill)\s*(?:no|number|num|#)\.?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/._]{1,24})/i;
  for (const l of lines) {
    const m = l.match(numRe);
    if (m && /\d/.test(m[1]) && !/^(date|dt)$/i.test(m[1])) { fields.invoice_number = { value: m[1].replace(/[.,]$/, ''), confidence: 0.9, source: l, flags: [] }; break; }
  }

  // ---- dates
  const dateAfter = (label: RegExp): { iso: string; src: string } | null => {
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      const m = lines[i].replace(label, ' ').match(new RegExp(DATE_SRC)) || (lines[i + 1] || '').match(new RegExp(DATE_SRC));
      if (m) { const iso = toIsoDate(m[1]); if (iso) return { iso, src: lines[i] }; }
    }
    return null;
  };
  const due = dateAfter(/due\s*date|payment\s*due|due\s*on/i);
  if (due) fields.due_date = { value: due.iso, confidence: 0.9, source: due.src, flags: [] };
  const inv = dateAfter(/(?:invoice|inv|bill)\s*date|\bdate\s*of\s*invoice|\bdated?\b\s*[:\-]/i);
  if (inv) fields.invoice_date = { value: inv.iso, confidence: 0.9, source: inv.src, flags: [] };
  else {
    for (const l of lines) {
      if (/due/i.test(l)) continue;
      const m = l.match(new RegExp(DATE_SRC)); const iso = m && toIsoDate(m[1]);
      if (iso) { fields.invoice_date = { value: iso, confidence: 0.4, source: l, flags: ['unlabelled'] }; break; }
    }
  }
  if (fields.invoice_date.value && fields.due_date.value && fields.due_date.value < fields.invoice_date.value)
    checks.push({ key: 'dates', status: 'warn', message: 'Due date is before the invoice date.' });

  // ---- currency
  const cur = lines.find((l) => /₹|\bINR\b|\bRs\.?\s*\d/i.test(l));
  if (cur) fields.currency = { value: 'INR', confidence: 0.8, source: cur, flags: [] };

  // ---- amounts
  const NOT_SUB = /sub\s*-?\s*total|tax\b.*total|total\s*(tax|gst|qty|quantity|discount)/i;
  fields.total_minor = money(
    labelled(lines, [/grand\s*total/i, /(?:invoice|bill)\s*(?:total|amount|value)/i, /(?:total\s*amount\s*(?:payable)?|amount\s*payable|net\s*payable|total\s*payable)/i, /^total\b/i], NOT_SUB), 0.9);
  fields.subtotal_minor = money(labelled(lines, [/taxable\s*(?:value|amount)/i, /total\s*taxable/i, /sub\s*-?\s*total/i, /net\s*amount/i]), 0.85);
  fields.cgst_minor = money(labelled(lines, [/\bcgst\b/i]), 0.85);
  fields.sgst_minor = money(labelled(lines, [/\b(?:sgst|utgst)\b/i]), 0.85);
  fields.igst_minor = money(labelled(lines, [/\bigst\b/i]), 0.85);
  fields.cess_minor = money(labelled(lines, [/\bcess\b/i]), 0.8);
  fields.round_off_minor = money(labelled(lines, [/round(?:ing)?\s*-?\s*off/i]), 0.8);

  // ---- vendor name (best effort)
  for (const l of lines.slice(0, 8)) {
    if (/invoice|gstin|date|page|original|duplicate|copy|tax\s|bill\s*to|^[\d\W]+$/i.test(l) || l.length < 3 || l.length > 80) continue;
    fields.vendor_name = { value: l, confidence: 0.35, source: l, flags: ['best_effort'] }; break;
  }

  // ---- checks
  if (fields.total_minor.value !== null && fields.subtotal_minor.value !== null) {
    const v = (f: Field<number>) => f.value ?? 0;
    const r = checkTotals({ subtotal_minor: v(fields.subtotal_minor), cgst_minor: v(fields.cgst_minor), sgst_minor: v(fields.sgst_minor), igst_minor: v(fields.igst_minor),
      cess_minor: v(fields.cess_minor), round_off_minor: v(fields.round_off_minor), total_minor: fields.total_minor.value });
    checks.push(r.ok
      ? { key: 'totals', status: 'pass', message: 'Taxable value plus taxes equals the invoice total.' }
      : { key: 'totals', status: 'fail', message: `Taxable value plus taxes is ${r.expected_minor / 100} but the total reads ${fields.total_minor.value / 100}. Check each amount.` });
    if (!r.ok) { fields.total_minor.flags.push('arithmetic_mismatch'); fields.total_minor.confidence = Math.min(fields.total_minor.confidence, 0.4); }
  } else {
    checks.push({ key: 'totals', status: 'info', message: 'Could not check arithmetic because the taxable value or total was not found.' });
  }
  if (fields.vendor_pan.value && !PAN_RE.test(fields.vendor_pan.value)) checks.push({ key: 'pan', status: 'warn', message: 'PAN format looks wrong.' });
  return { fields, checks };
}

/** Compare an extraction with a hand-written expected JSON; used by the accuracy harness. */
export function compareWithExpected(ex: Extraction, expected: Record<string, any>) {
  const rows: { field: string; expected: any; got: any; ok: boolean }[] = [];
  for (const [k, v] of Object.entries(expected)) {
    const got = (ex.fields as any)[k]?.value ?? null;
    rows.push({ field: k, expected: v, got, ok: got === v });
  }
  return rows;
}
