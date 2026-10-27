import { applyBps } from '../lib/money';

/** Tax configuration is DATA owned by each organisation. No rates or rules are hardcoded here. */
export interface TdsSection { section: string; description: string; rate_bps: number; threshold_minor: number | null; }
export interface TaxSettings { gstin: string | null; state_code: string | null; tds_sections: TdsSection[]; }

export function computeTds(taxableMinor: number, sectionKey: string | null | undefined, sections: TdsSection[]) {
  if (!sectionKey) return { section: null, rate_bps: 0, amount_minor: 0, note: 'No TDS section set for this vendor' };
  const sec = sections.find((s) => s.section === sectionKey);
  if (!sec) throw new Error(`TDS section "${sectionKey}" is not configured for this organisation.`);
  if (sec.threshold_minor !== null && taxableMinor < sec.threshold_minor)
    return { section: sec.section, rate_bps: sec.rate_bps, amount_minor: 0, note: 'Below configured threshold' };
  return { section: sec.section, rate_bps: sec.rate_bps, amount_minor: applyBps(taxableMinor, sec.rate_bps), note: 'Computed from organisation settings' };
}

export interface Totals { subtotal_minor: number; cgst_minor: number; sgst_minor: number; igst_minor: number; cess_minor: number; round_off_minor: number; total_minor: number; }
export function checkTotals(t: Totals): { ok: boolean; expected_minor: number } {
  const expected = t.subtotal_minor + t.cgst_minor + t.sgst_minor + t.igst_minor + t.cess_minor + t.round_off_minor;
  return { ok: expected === t.total_minor, expected_minor: expected };
}
