export type ApprovalMode = 'sequential' | 'parallel';

export interface Rule {
  id: string; name: string;
  min_minor: number; max_minor: number | null;       // min inclusive, max exclusive, null = no upper bound
  department: string | null; cost_centre: string | null; vendor_category: string | null;
  approvers_required: number; mode: ApprovalMode;
  role_ids: string[]; user_ids: string[];
  escalation_hours: number; priority: number; is_active: boolean;
}
export interface InvoiceCtx { total_minor: number; department?: string | null; cost_centre?: string | null; vendor_category?: string | null; }

const filtersUsed = (r: Rule) => [r.department, r.cost_centre, r.vendor_category].filter((x) => x).length;

export function matchRule(rules: Rule[], ctx: InvoiceCtx): Rule | null {
  const fits = rules.filter((r) =>
    r.is_active &&
    ctx.total_minor >= r.min_minor &&
    (r.max_minor === null || ctx.total_minor < r.max_minor) &&
    (!r.department || r.department === ctx.department) &&
    (!r.cost_centre || r.cost_centre === ctx.cost_centre) &&
    (!r.vendor_category || r.vendor_category === ctx.vendor_category));
  if (!fits.length) return null;
  fits.sort((a, b) =>
    b.priority - a.priority ||
    filtersUsed(b) - filtersUsed(a) ||
    (a.max_minor ?? Infinity) - a.min_minor - ((b.max_minor ?? Infinity) - b.min_minor) ||
    a.id.localeCompare(b.id));
  return fits[0];
}

export interface Candidate {
  id: string; role_id: string; active: boolean;
  limit_minor: number | null;           // null = unlimited
  departments: string[]; cost_centres: string[]; // empty = all
  can_approve: boolean;                 // holds invoice.approve
}
export type Choice = { ok: true; steps: { user_id: string; step_order: number }[] } | { ok: false; reason: string };

/**
 * Pick distinct approvers for a rule. Every chosen approver must be allowed to approve the FULL amount
 * (approval limit >= invoice total, or unlimited), must be in scope, and must not be a creator/editor.
 * Sequential steps are ordered by ascending limit (most junior first).
 */
export function chooseApprovers(rule: Rule, candidates: Candidate[], ctx: InvoiceCtx, excludeUserIds: string[]): Choice {
  const ex = new Set(excludeUserIds.map(String));
  const inScope = (list: string[], v?: string | null) => list.length === 0 || (!!v && list.includes(v));
  const eligible = candidates.filter((c) =>
    c.active && c.can_approve && !ex.has(String(c.id)) &&
    (rule.user_ids.length === 0 || rule.user_ids.includes(c.id)) &&
    (rule.role_ids.length === 0 || rule.role_ids.includes(c.role_id)) &&
    inScope(c.departments, ctx.department) && inScope(c.cost_centres, ctx.cost_centre) &&
    (c.limit_minor === null || c.limit_minor >= ctx.total_minor));
  if (eligible.length < rule.approvers_required) {
    return { ok: false, reason: `Rule "${rule.name}" needs ${rule.approvers_required} approver(s) with an approval limit covering this invoice, but only ${eligible.length} eligible approver(s) exist.` };
  }
  eligible.sort((a, b) => (a.limit_minor ?? Infinity) - (b.limit_minor ?? Infinity) || a.id.localeCompare(b.id));
  const chosen = eligible.slice(0, rule.approvers_required);
  return { ok: true, steps: chosen.map((c, i) => ({ user_id: c.id, step_order: i + 1 })) };
}

/** Which steps may act now. Sequential: only the lowest pending order, and only if earlier ones approved. */
export function actionableSteps<T extends { step_order: number; status: string }>(steps: T[], mode: ApprovalMode): T[] {
  const pending = steps.filter((s) => s.status === 'pending');
  if (mode === 'parallel') return pending;
  if (steps.some((s) => s.status === 'rejected')) return [];
  const lowest = Math.min(...pending.map((s) => s.step_order));
  return pending.filter((s) => s.step_order === lowest);
}
