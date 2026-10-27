export function formatMinor(minor: number | null | undefined, currency = 'INR'): string {
  if (minor === null || minor === undefined) return '—';
  const neg = minor < 0; const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString(); const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = currency === 'INR' ? (whole.length > 3 ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3) : whole) : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency === 'INR' ? '₹' : currency + ' '}${grouped}.${frac}`;
}
/** "1,23,456.78" -> 12345678. Returns null when empty, NaN-safe: throws on garbage. */
export function parseRupees(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]|rs\.?/gi, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${input}" is not a valid amount (use up to 2 decimals).`);
  const neg = s.startsWith('-'); const [w, f = ''] = s.replace('-', '').split('.');
  const m = parseInt(w, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
  return neg ? -m : m;
}
export const toRupeesInput = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2));
export const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d: any) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const isoDate = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');
