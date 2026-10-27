// Bank statement matching engine. PURE: no database access. The caller persists proposals.
export interface MLine { id: string; date: Date; narration: string; reference?: string | null; debit_minor: number; credit_minor: number; }
export interface MPay { id: string; reference: string; utr?: string | null; net_minor: number; reconciled_minor: number; vendor_name: string; run_id?: string | null; released_at: Date; }
export interface MConfig { tolerance_minor: number; date_window_days: number; classifiers: { pattern: string; category: string }[]; }
export interface Allocation { line_id: string; payment_id: string; amount_minor: number; }
export type Proposal =
  | { kind: 'match'; allocations: Allocation[]; method: string; confidence: number }       // safe to apply automatically
  | { kind: 'suggestion'; allocations: Allocation[]; method: string; confidence: number }  // weak: a person must confirm
  | { kind: 'exception'; line_id: string; reason: string; candidates: string[] }
  | { kind: 'classified'; line_id: string; category: string };

export const DEFAULT_MATCH_CONFIG: MConfig = { tolerance_minor: 0, date_window_days: 5, classifiers: [] };

const norm = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const STOP = new Set(['PVT', 'LTD', 'LLP', 'PRIVATE', 'LIMITED', 'INC', 'CO', 'THE', 'AND', 'CORP', 'COMPANY']);

export function vendorTokens(name: string): string[] {
  return (name || '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
export function vendorScore(name: string, narration: string): number {
  const toks = vendorTokens(name);
  if (!toks.length) return 0;
  const n = norm(narration);
  const hit = toks.filter((t) => n.includes(t));
  if (!hit.some((t) => t.length >= 4)) return 0;
  return hit.length / toks.length;
}

/** All subsets (max 2 returned) of items whose amounts sum to target within tolerance. */
export function subsetSums(items: { id: string; amount: number }[], target: number, tol: number): string[][] {
  const arr = items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 22);
  const suffix: number[] = new Array(arr.length + 1).fill(0);
  for (let i = arr.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + arr[i].amount;
  const found: string[][] = [];
  const seen = new Set<string>();
  const cur: string[] = [];
  const dfs = (i: number, sum: number) => {
    if (found.length >= 2) return;
    if (Math.abs(sum - target) <= tol && cur.length >= 2) {
      const key = [...cur].sort().join('|');
      if (!seen.has(key)) { seen.add(key); found.push([...cur]); }
    }
    if (i >= arr.length || sum > target + tol || sum + suffix[i] < target - tol) return;
    cur.push(arr[i].id); dfs(i + 1, sum + arr[i].amount); cur.pop();
    dfs(i + 1, sum);
  };
  dfs(0, 0);
  return found;
}

export function matchLines(lines: MLine[], pays: MPay[], cfg: MConfig = DEFAULT_MATCH_CONFIG): Proposal[] {
  const out: Proposal[] = [];
  const allocated = new Map<string, number>();
  const outstanding = (p: MPay) => p.net_minor - p.reconciled_minor - (allocated.get(p.id) || 0);
  const reserve = (a: Allocation[]) => a.forEach((x) => allocated.set(x.payment_id, (allocated.get(x.payment_id) || 0) + x.amount_minor));
  const tol = cfg.tolerance_minor;
  const classifiers = cfg.classifiers.flatMap((c) => { try { return [{ re: new RegExp(c.pattern, 'i'), category: c.category }]; } catch { return []; } });

  const sorted = [...lines].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const line of sorted) {
    const cls = classifiers.find((c) => c.re.test(line.narration));
    if (cls) { out.push({ kind: 'classified', line_id: line.id, category: cls.category }); continue; }
    if (!(line.debit_minor > 0) || line.credit_minor > 0) continue; // only debits can confirm vendor payments
    const debit = line.debit_minor;
    const open = pays.filter((p) => outstanding(p) > tol);
    const nn = norm(line.narration);
    const refN = norm(line.reference);

    // Rule 1: our payment reference (or bank UTR) appears on the bank line.
    const refCands = open.filter((p) => (norm(p.reference) && nn.includes(norm(p.reference))) ||
      (p.utr && (refN === norm(p.utr) || nn.includes(norm(p.utr)))));
    if (refCands.length === 1) {
      const p = refCands[0]; const o = outstanding(p);
      if (Math.abs(o - debit) <= tol) {
        const al = [{ line_id: line.id, payment_id: p.id, amount_minor: Math.min(debit, o) }]; reserve(al);
        out.push({ kind: 'match', allocations: al, method: 'reference', confidence: 0.99 });
      } else if (debit < o) {
        const al = [{ line_id: line.id, payment_id: p.id, amount_minor: debit }]; reserve(al);
        out.push({ kind: 'match', allocations: al, method: 'reference_partial', confidence: 0.9 });
      } else {
        out.push({ kind: 'exception', line_id: line.id, reason: 'amount_exceeds_payment', candidates: [p.id] });
      }
      continue;
    }
    if (refCands.length > 1) {
      const ss = subsetSums(refCands.map((p) => ({ id: p.id, amount: outstanding(p) })), debit, tol);
      if (ss.length === 1) {
        const al = ss[0].map((id) => ({ line_id: line.id, payment_id: id, amount_minor: outstanding(refCands.find((p) => p.id === id)!) })); reserve(al);
        out.push({ kind: 'match', allocations: al, method: 'reference_batch', confidence: 0.97 });
      } else {
        out.push({ kind: 'exception', line_id: line.id, reason: ss.length ? 'ambiguous_batch' : 'reference_amount_mismatch', candidates: refCands.map((p) => p.id) });
      }
      continue;
    }

    // Rule 2: exact amount + vendor name on the line.
    const amountCands = open.filter((p) => Math.abs(outstanding(p) - debit) <= tol);
    const vendorCands = amountCands.filter((p) => vendorScore(p.vendor_name, line.narration) >= 0.5);
    if (vendorCands.length === 1) {
      const al = [{ line_id: line.id, payment_id: vendorCands[0].id, amount_minor: debit }]; reserve(al);
      out.push({ kind: 'match', allocations: al, method: 'amount_vendor', confidence: 0.85 });
      continue;
    }
    if (vendorCands.length > 1) {
      out.push({ kind: 'exception', line_id: line.id, reason: 'ambiguous', candidates: vendorCands.map((p) => p.id) });
      continue;
    }

    // Rule 3: exact amount inside the date window (weak: needs a person to confirm).
    const dateCands = amountCands.filter((p) => Math.abs(line.date.getTime() - p.released_at.getTime()) / 86400000 <= cfg.date_window_days);
    if (dateCands.length === 1) {
      const al = [{ line_id: line.id, payment_id: dateCands[0].id, amount_minor: debit }]; reserve(al);
      out.push({ kind: 'suggestion', allocations: al, method: 'amount_date', confidence: 0.6 });
      continue;
    }
    if (dateCands.length > 1) {
      out.push({ kind: 'exception', line_id: line.id, reason: 'ambiguous', candidates: dateCands.map((p) => p.id) });
      continue;
    }

    // Rule 4: one bank debit paying a whole group (run) of payments.
    const groups = new Map<string, MPay[]>();
    open.forEach((p) => { if (p.run_id) groups.set(p.run_id, [...(groups.get(p.run_id) || []), p]); });
    const batchHits: string[][] = [];
    groups.forEach((g) => batchHits.push(...subsetSums(g.map((p) => ({ id: p.id, amount: outstanding(p) })), debit, tol)));
    if (batchHits.length === 1) {
      const al = batchHits[0].map((id) => ({ line_id: line.id, payment_id: id, amount_minor: outstanding(open.find((p) => p.id === id)!) })); reserve(al);
      out.push({ kind: 'suggestion', allocations: al, method: 'batch_sum', confidence: 0.75 });
    } else if (batchHits.length > 1) {
      out.push({ kind: 'exception', line_id: line.id, reason: 'ambiguous_batch', candidates: Array.from(new Set(batchHits.flat())) });
    } else {
      out.push({ kind: 'exception', line_id: line.id, reason: 'no_candidate', candidates: [] });
    }
  }
  return out;
}
