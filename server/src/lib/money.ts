// All money in the system is stored as INTEGER MINOR UNITS (paise for INR). Never use floats for money.

export function isMinor(n: any): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** Parse a human string like "1,23,456.78", "₹ 4,54,300", "(250.00)" into minor units. Throws on garbage. */
export function parseMajorToMinor(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid amount');
    const m = Math.round(input * 100);
    if (Math.abs(input * 100 - m) > 1e-6) throw new Error(`Amount has more than 2 decimal places: ${input}`);
    return m;
  }
  let s = String(input).trim();
  if (!s) throw new Error('Empty amount');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[₹\s]|rs\.?|inr/gi, '').replace(/,/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${input}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`Amount has more than 2 decimal places: ${input}`);
  const minor = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  if (!Number.isSafeInteger(minor)) throw new Error('Amount too large');
  return neg ? -minor : minor;
}

/** Format minor units. INR uses Indian digit grouping (lakh/crore). */
export function formatMinor(minor: number, currency = 'INR'): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  let grouped: string;
  if (currency === 'INR') {
    grouped = whole.length > 3
      ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3)
      : whole;
  } else {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const sym = currency === 'INR' ? '₹' : currency + ' ';
  return `${neg ? '-' : ''}${sym}${grouped}.${frac}`;
}

/** minor * bps / 10000, rounded half away from zero, integer-safe. */
export function applyBps(minor: number, bps: number): number {
  if (!Number.isSafeInteger(minor) || !Number.isInteger(bps)) throw new Error('applyBps requires integers');
  const num = minor * bps;
  if (!Number.isSafeInteger(num)) throw new Error('Amount too large for percentage calculation');
  const q = Math.floor(Math.abs(num) / 10000);
  const r = Math.abs(num) % 10000;
  const rounded = r >= 5000 ? q + 1 : q;
  return num < 0 ? -rounded : rounded;
}

export const sumMinor = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
