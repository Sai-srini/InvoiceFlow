import { parse as parseCsv } from 'csv-parse/sync';
import { sha256 } from '../lib/crypto';

export interface StatementProfileCfg {
  header_row: number;                 // 0-based index of the header row
  date_column: string; date_format: string;
  narration_column: string; reference_column?: string | null;
  amount_mode: 'separate' | 'signed' | 'amount_drcr';
  debit_column?: string | null; credit_column?: string | null;
  amount_column?: string | null; drcr_column?: string | null;
  balance_column?: string | null;
  decimal_separator: '.' | ',';
  skip_footer_rows: number;
}
export interface ParsedLine { row_number: number; date: Date; narration: string; reference: string | null; debit_minor: number; credit_minor: number; balance_minor: number | null; }
export interface ParseResult { lines: ParsedLine[]; errors: { row: number; message: string }[]; }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const SUPPORTED_DATE_FORMATS = ['DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'DD-MM-YY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'DD MMM YY'];

function build(y: number, m: number, d: number): Date | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** Strict date parse (UTC midnight). Returns null for anything that does not fit the stated format. */
export function parseDate(raw: string, format: string): Date | null {
  const s = (raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  if (format === 'YYYY-MM-DD') return null;
  if (format.includes('MMM')) {
    m = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3})[A-Za-z]*[\s\-\/,]+(\d{2}|\d{4})$/);
    if (!m) return null;
    const mi = MONTHS.indexOf(m[2].toUpperCase());
    return mi < 0 ? null : build(+m[3], mi + 1, +m[1]);
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const yy = format.endsWith('YYYY') ? 4 : 2;
  if (m[3].length !== yy) return null;
  return format.startsWith('MM') ? build(+m[3], +m[1], +m[2]) : build(+m[3], +m[2], +m[1]);
}

/** Parse "1,23,456.78", "(100.00)", "100.00 Dr", "1.234,56" (decimal comma) into signed minor units. null = blank. */
export function parseAmountMinor(raw: string | null | undefined, decimalSep: '.' | ','): number | null {
  let s = (raw ?? '').toString().trim();
  if (!s || s === '-' || s === '--') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bDR\b\.?$/i.test(s)) { neg = true; s = s.replace(/\s*DR\.?$/i, ''); }
  else if (/\bCR\b\.?$/i.test(s)) { s = s.replace(/\s*CR\.?$/i, ''); }
  s = s.replace(/[₹\s]|rs\.?|inr/gi, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  s = decimalSep === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Cannot read amount "${raw}"`);
  const [w, f = ''] = s.split('.');
  if (f.length > 2 && /[1-9]/.test(f.slice(2))) throw new Error(`Amount "${raw}" has more than 2 decimal places`);
  const minor = parseInt(w, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  return neg ? -minor : minor;
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const score = Math.min(...counts) * 2 + (counts.every((c) => c === counts[0]) ? 1 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
export function csvToRows(text: string): string[][] {
  return parseCsv(text, { relax_column_count: true, skip_empty_lines: true, bom: true, delimiter: detectDelimiter(text), relax_quotes: true }) as string[][];
}

const nk = (s: string) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

export function parseStatementRows(rows: string[][], p: StatementProfileCfg, opts: { forceDecimalDot?: boolean } = {}): ParseResult {
  const errors: ParseResult['errors'] = [];
  const dec = opts.forceDecimalDot ? '.' : p.decimal_separator;
  const header = rows[p.header_row];
  if (!header) return { lines: [], errors: [{ row: p.header_row + 1, message: `Header row ${p.header_row + 1} does not exist in this file.` }] };
  const idx = (name?: string | null) => (name ? header.findIndex((h) => nk(h) === nk(name)) : -1);
  const need = (label: string, name?: string | null) => {
    const i = idx(name);
    if (i < 0) errors.push({ row: p.header_row + 1, message: `Column "${name}" (${label}) not found. Columns in file: ${header.map((h) => `"${(h || '').trim()}"`).join(', ')}` });
    return i;
  };
  const cDate = need('date', p.date_column), cNar = need('narration', p.narration_column);
  const cRef = p.reference_column ? need('reference', p.reference_column) : -1;
  const cDeb = p.amount_mode === 'separate' ? need('debit', p.debit_column) : -1;
  const cCre = p.amount_mode === 'separate' ? need('credit', p.credit_column) : -1;
  const cAmt = p.amount_mode !== 'separate' ? need('amount', p.amount_column) : -1;
  const cDrCr = p.amount_mode === 'amount_drcr' ? need('Dr/Cr', p.drcr_column) : -1;
  const cBal = p.balance_column ? need('balance', p.balance_column) : -1;
  if (errors.length) return { lines: [], errors };

  const lines: ParsedLine[] = [];
  const end = rows.length - Math.max(0, p.skip_footer_rows);
  for (let r = p.header_row + 1; r < end; r++) {
    const row = rows[r] || [];
    if (row.every((c) => !(c || '').toString().trim())) continue;
    const rn = r + 1;
    const date = parseDate(row[cDate] || '', p.date_format);
    if (!date) { errors.push({ row: rn, message: `Date "${row[cDate] ?? ''}" does not match format ${p.date_format}.` }); continue; }
    try {
      let debit = 0, credit = 0;
      if (p.amount_mode === 'separate') {
        const d = parseAmountMinor(row[cDeb], dec), c = parseAmountMinor(row[cCre], dec);
        debit = Math.abs(d || 0); credit = Math.abs(c || 0);
        if (debit && credit) throw new Error('Row has both a debit and a credit amount');
      } else {
        const a = parseAmountMinor(row[cAmt], dec);
        if (a === null) throw new Error('Amount is blank');
        if (p.amount_mode === 'signed') { if (a < 0) debit = -a; else credit = a; }
        else { const t = (row[cDrCr] || '').trim().toUpperCase(); if (t.startsWith('D')) debit = Math.abs(a); else if (t.startsWith('C')) credit = Math.abs(a); else throw new Error(`Dr/Cr value "${row[cDrCr] ?? ''}" not understood`); }
      }
      if (!debit && !credit) throw new Error('Row has neither a debit nor a credit amount');
      lines.push({ row_number: rn, date, narration: (row[cNar] || '').toString().trim(),
        reference: cRef >= 0 ? ((row[cRef] || '').toString().trim() || null) : null,
        debit_minor: debit, credit_minor: credit,
        balance_minor: cBal >= 0 ? parseAmountMinor(row[cBal], dec) : null });
    } catch (e: any) { errors.push({ row: rn, message: e.message }); }
  }
  return { lines, errors };
}

/** Stable per-line fingerprint. Identical rows inside one file get distinct occurrence numbers so re-importing is idempotent. */
export function fingerprintLines<T extends ParsedLine>(accountId: string, lines: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = [accountId, l.date.toISOString().slice(0, 10), l.narration, l.reference || '', l.debit_minor, l.credit_minor, l.balance_minor ?? ''].join('|');
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return { ...l, fingerprint: sha256(`${base}|#${n}`) };
  });
}

export interface BalanceCheck { checked: boolean; ok: boolean; order: 'file' | 'reversed' | 'n/a'; mismatches: { row_number: number; expected_minor: number; actual_minor: number }[]; opening_minor: number | null; closing_minor: number | null; }

/** opening + credits - debits = closing, verified line by line when balances are present. Detects descending statements. */
export function checkBalances(lines: ParsedLine[]): BalanceCheck {
  const withBal = lines.length > 0 && lines.every((l) => l.balance_minor !== null);
  if (!withBal) return { checked: false, ok: true, order: 'n/a', mismatches: [], opening_minor: null, closing_minor: null };
  const run = (ls: ParsedLine[]) => {
    const mism: BalanceCheck['mismatches'] = [];
    for (let i = 1; i < ls.length; i++) {
      const exp = ls[i - 1].balance_minor! + ls[i].credit_minor - ls[i].debit_minor;
      if (exp !== ls[i].balance_minor) mism.push({ row_number: ls[i].row_number, expected_minor: exp, actual_minor: ls[i].balance_minor! });
    }
    return mism;
  };
  let order: 'file' | 'reversed' = 'file';
  let ls = lines; let mism = run(ls);
  if (mism.length) { const rev = [...lines].reverse(); const m2 = run(rev); if (m2.length < mism.length) { ls = rev; mism = m2; order = 'reversed'; } }
  const first = ls[0];
  return { checked: true, ok: mism.length === 0, order, mismatches: mism.slice(0, 20),
    opening_minor: first.balance_minor! - first.credit_minor + first.debit_minor, closing_minor: ls[ls.length - 1].balance_minor };
}
