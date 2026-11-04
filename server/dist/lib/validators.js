"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseInvoiceNumber = exports.isValidIfsc = exports.isValidPan = exports.IFSC_RE = exports.PAN_RE = exports.GSTIN_RE = void 0;
exports.isValidStateCode = isValidStateCode;
exports.gstinCheckChar = gstinCheckChar;
exports.validateGstin = validateGstin;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
exports.GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
exports.PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
exports.IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** GST state / UT codes 01-38 plus 97 (other territory) and 99 (centre). */
function isValidStateCode(code) {
    const n = parseInt(code, 10);
    return (n >= 1 && n <= 38) || n === 97 || n === 99;
}
/** Check character for the first 14 characters of a GSTIN (mod-36, alternating weights). */
function gstinCheckChar(first14) {
    if (first14.length !== 14)
        return null;
    let factor = 2;
    let sum = 0;
    for (let i = first14.length - 1; i >= 0; i--) {
        const cp = CHARS.indexOf(first14[i]);
        if (cp < 0)
            return null;
        let digit = factor * cp;
        factor = factor === 2 ? 1 : 2;
        digit = Math.floor(digit / 36) + (digit % 36);
        sum += digit;
    }
    return CHARS[(36 - (sum % 36)) % 36];
}
function validateGstin(raw) {
    const g = (raw || '').trim().toUpperCase();
    const structure = exports.GSTIN_RE.test(g);
    if (!structure)
        return { structure: false, stateCode: false, checksum: false, pan: null };
    const stateCode = isValidStateCode(g.slice(0, 2));
    const checksum = gstinCheckChar(g.slice(0, 14)) === g[14];
    const pan = g.slice(2, 12);
    return { structure, stateCode, checksum, pan: exports.PAN_RE.test(pan) ? pan : null };
}
const isValidPan = (s) => exports.PAN_RE.test((s || '').trim().toUpperCase());
exports.isValidPan = isValidPan;
const isValidIfsc = (s) => exports.IFSC_RE.test((s || '').trim().toUpperCase());
exports.isValidIfsc = isValidIfsc;
/** "INV-2291 / A" -> "INV2291A" : used for duplicate detection. */
const normaliseInvoiceNumber = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
exports.normaliseInvoiceNumber = normaliseInvoiceNumber;
//# sourceMappingURL=validators.js.map