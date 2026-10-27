const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** GST state / UT codes 01-38 plus 97 (other territory) and 99 (centre). */
export function isValidStateCode(code: string): boolean {
  const n = parseInt(code, 10);
  return (n >= 1 && n <= 38) || n === 97 || n === 99;
}

/** Check character for the first 14 characters of a GSTIN (mod-36, alternating weights). */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = CHARS.indexOf(first14[i]);
    if (cp < 0) return null;
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export interface GstinResult { structure: boolean; stateCode: boolean; checksum: boolean; pan: string | null; }
export function validateGstin(raw: string): GstinResult {
  const g = (raw || '').trim().toUpperCase();
  const structure = GSTIN_RE.test(g);
  if (!structure) return { structure: false, stateCode: false, checksum: false, pan: null };
  const stateCode = isValidStateCode(g.slice(0, 2));
  const checksum = gstinCheckChar(g.slice(0, 14)) === g[14];
  const pan = g.slice(2, 12);
  return { structure, stateCode, checksum, pan: PAN_RE.test(pan) ? pan : null };
}
export const isValidPan = (s: string) => PAN_RE.test((s || '').trim().toUpperCase());
export const isValidIfsc = (s: string) => IFSC_RE.test((s || '').trim().toUpperCase());

/** "INV-2291 / A" -> "INV2291A" : used for duplicate detection. */
export const normaliseInvoiceNumber = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
