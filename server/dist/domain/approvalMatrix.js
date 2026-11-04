"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchRule = matchRule;
exports.chooseApprovers = chooseApprovers;
exports.actionableSteps = actionableSteps;
const filtersUsed = (r) => [r.department, r.cost_centre, r.vendor_category].filter((x) => x).length;
function matchRule(rules, ctx) {
    const fits = rules.filter((r) => r.is_active &&
        ctx.total_minor >= r.min_minor &&
        (r.max_minor === null || ctx.total_minor < r.max_minor) &&
        (!r.department || r.department === ctx.department) &&
        (!r.cost_centre || r.cost_centre === ctx.cost_centre) &&
        (!r.vendor_category || r.vendor_category === ctx.vendor_category));
    if (!fits.length)
        return null;
    fits.sort((a, b) => b.priority - a.priority ||
        filtersUsed(b) - filtersUsed(a) ||
        (a.max_minor ?? Infinity) - a.min_minor - ((b.max_minor ?? Infinity) - b.min_minor) ||
        a.id.localeCompare(b.id));
    return fits[0];
}
/**
 * Pick distinct approvers for a rule. Every chosen approver must be allowed to approve the FULL amount
 * (approval limit >= invoice total, or unlimited), must be in scope, and must not be a creator/editor.
 * Sequential steps are ordered by ascending limit (most junior first).
 */
function chooseApprovers(rule, candidates, ctx, excludeUserIds) {
    const ex = new Set(excludeUserIds.map(String));
    const inScope = (list, v) => list.length === 0 || (!!v && list.includes(v));
    const eligible = candidates.filter((c) => c.active && c.can_approve && !ex.has(String(c.id)) &&
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
function actionableSteps(steps, mode) {
    const pending = steps.filter((s) => s.status === 'pending');
    if (mode === 'parallel')
        return pending;
    if (steps.some((s) => s.status === 'rejected'))
        return [];
    const lowest = Math.min(...pending.map((s) => s.step_order));
    return pending.filter((s) => s.step_order === lowest);
}
//# sourceMappingURL=approvalMatrix.js.map