import { Invoice, Vendor, ApprovalRule, ApprovalStep, Role, User, Delegation, InvoiceComment } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertTransition } from '../domain/stateMachine';
import { matchRule, chooseApprovers, actionableSteps, Rule, Candidate } from '../domain/approvalMatrix';
import { checkSelfApproval, checkApprovalLimit } from '../domain/policy';
import { getSod } from './org.service';
import { notify, notifyMany } from './notification.service';
import { loadVisible, invoiceDto } from './invoice.service';

const toRule = (r: any): Rule => ({ id: String(r._id), name: r.name, min_minor: r.min_minor, max_minor: r.max_minor ?? null, department: r.department || null, cost_centre: r.cost_centre || null,
  vendor_category: r.vendor_category || null, approvers_required: r.approvers_required, mode: r.mode, role_ids: (r.role_ids || []).map(String), user_ids: (r.user_ids || []).map(String),
  escalation_hours: r.escalation_hours, priority: r.priority, is_active: r.is_active });
export const ruleDto = (r: any) => ({ ...toRule(r), createdAt: r.createdAt });

async function candidates(orgId: string): Promise<Candidate[]> {
  const roles: any[] = await Role.find({ organisation_id: orgId, permissions: 'invoice.approve' }).lean();
  const ids = roles.map((r) => r._id);
  const users: any[] = await User.find({ organisation_id: orgId, is_active: true, role_id: { $in: ids } }).lean();
  return users.map((u) => ({ id: String(u._id), role_id: String(u.role_id), active: u.is_active, limit_minor: u.approval_unlimited ? null : (u.approval_limit_minor ?? 0),
    departments: u.departments || [], cost_centres: u.cost_centres || [], can_approve: true }));
}

/** Draft -> in_review. Picks the approval rule and approvers; fails clearly when nobody is eligible. */
export async function submitInvoice(actor: Actor, id: string) {
  const inv: any = await loadVisible(actor, id);
  const mine = String(inv.created_by) === actor.userId;
  if (!actor.permissions.has('invoice.edit_before_approval') && !(mine && actor.permissions.has('invoice.create_own'))) throw forbidden('You cannot submit this invoice.', 'MISSING_PERMISSION');
  const next = (() => { try { return assertTransition(inv.status, 'submit'); } catch (e: any) { throw conflict(e.message, 'INVALID_TRANSITION'); } })();
  const vendor: any = await Vendor.findOne({ _id: inv.vendor_id, organisation_id: actor.orgId }).lean();
  if (!vendor || vendor.status !== 'active') throw conflict('The vendor must be approved and active before an invoice can be submitted.', 'VENDOR_NOT_ACTIVE');
  if (!vendor.bank?.account_number_enc) throw conflict('The vendor has no bank details on file.', 'VENDOR_NO_BANK');
  const rules = (await ApprovalRule.find({ organisation_id: actor.orgId, is_active: true }).lean()).map(toRule);
  const rule = matchRule(rules, { total_minor: inv.total_minor, department: inv.department, cost_centre: inv.cost_centre, vendor_category: vendor.category });
  if (!rule) throw conflict('No approval rule matches this invoice. Ask a Finance Head to add one.', 'NO_APPROVAL_RULE');
  const exclude = [String(inv.created_by), ...(inv.edited_by || []).map(String), actor.userId];
  const choice = chooseApprovers(rule, await candidates(actor.orgId), { total_minor: inv.total_minor, department: inv.department, cost_centre: inv.cost_centre }, exclude);
  if (choice.ok === false) throw conflict(choice.reason, 'NO_ELIGIBLE_APPROVERS');
  const picked = (choice as { ok: true; steps: { user_id: string; step_order: number }[] }).steps;
  return withTxn(async (session) => {
    const round = (inv.approval_round || 0) + 1;
    const now = new Date();
    await ApprovalStep.create(picked.map((s) => ({ organisation_id: actor.orgId, invoice_id: inv._id, approver_id: s.user_id, step_order: s.step_order, round, status: 'pending',
      activated_at: rule.mode === 'parallel' || s.step_order === 1 ? now : null, escalation_hours: rule.escalation_hours })), { session, ordered: true });
    inv.status = next; inv.rule_id = rule.id; inv.rule_name = rule.name; inv.approval_mode = rule.mode; inv.approval_round = round; inv.submitted_at = now; inv.hold = undefined; inv.rejection = undefined;
    await inv.save({ session });
    await writeAudit(actor, { action: 'invoice.submitted', entity_type: 'Invoice', entity_id: id, new_values: { rule: rule.name, approvers: picked.map((s) => s.user_id), mode: rule.mode } }, session);
    const first = rule.mode === 'parallel' ? picked : picked.filter((s) => s.step_order === 1);
    await notifyMany(actor.orgId, first.map((s) => s.user_id), { kind: 'approval.requested', title: `Approval needed: invoice ${inv.number}`, body: `${vendor.name} · ${inv.total_minor / 100}`, entity_type: 'Invoice', entity_id: id }, session);
    return invoiceDto(inv);
  });
}

/** A step belongs to the actor directly, or through an active delegation from the assigned approver. */
async function findActorStep(actor: Actor, invoice: any, steps: any[]) {
  const live = actionableSteps(steps, invoice.approval_mode);
  const now = new Date();
  const delegations: any[] = await Delegation.find({ organisation_id: actor.orgId, to_user: actor.userId, revoked_at: null, starts_at: { $lte: now }, ends_at: { $gte: now } }).lean();
  const principals = new Set(delegations.map((d) => String(d.from_user)));
  const own = live.find((s) => String(s.approver_id) === actor.userId);
  if (own) return { step: own, onBehalfOf: null as string | null };
  const del = live.find((s) => principals.has(String(s.approver_id)));
  if (del) return { step: del, onBehalfOf: String(del.approver_id) };
  const assigned = steps.find((s) => s.status === 'pending' && (String(s.approver_id) === actor.userId || principals.has(String(s.approver_id))));
  if (assigned) throw conflict('This invoice is not waiting for you yet. An earlier approval step must be completed first.', 'NOT_YOUR_TURN');
  throw forbidden('This invoice is not assigned to you.', 'NOT_ASSIGNED');
}

async function loadForDecision(actor: Actor, id: string) {
  const inv: any = await loadVisible(actor, id);
  if (inv.status !== 'in_review') throw conflict(`This invoice is ${inv.status}, so it cannot be decided.`, 'INVALID_TRANSITION');
  const steps: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round });
  return { inv, steps };
}

export async function decide(actor: Actor, id: string, decision: 'approve' | 'reject', comment?: string) {
  const { inv, steps } = await loadForDecision(actor, id);
  const sod = await getSod(actor.orgId);
  const self = checkSelfApproval(sod, actor.userId, inv);
  if (self) throw forbidden(self.message, 'SOD_VIOLATION', { rule: self.rule });
  const { step, onBehalfOf } = await findActorStep(actor, inv, steps);
  const u = actor.user;
  const lim = checkApprovalLimit(u.approval_unlimited ? null : (u.approval_limit_minor ?? 0), inv.total_minor);
  if (decision === 'approve' && lim) throw forbidden(lim.message, 'APPROVAL_LIMIT', { rule: lim.rule, invoice_total_minor: inv.total_minor });
  if (decision === 'reject' && (!comment || comment.trim().length < 5)) throw badRequest('A reason of at least 5 characters is required to reject.');
  return withTxn(async (session) => {
    const fresh: any = await ApprovalStep.findOneAndUpdate({ _id: step._id, organisation_id: actor.orgId, status: 'pending' },
      { $set: { status: decision === 'approve' ? 'approved' : 'rejected', acted_by: actor.userId, on_behalf_of: onBehalfOf, comment, decided_at: new Date() } }, { returnDocument: 'after', session });
    if (!fresh) throw conflict('This step has already been decided.', 'ALREADY_DECIDED');
    if (comment) await InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'decision', body: comment }], { session });
    const all: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round }).session(session || null);
    if (decision === 'reject') {
      await ApprovalStep.updateMany({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round, status: 'pending' }, { $set: { status: 'cancelled' } }, { session });
      inv.status = assertTransition('in_review', 'reject'); inv.rejection = { reason: comment, by: actor.userId, at: new Date() };
      await notify(actor.orgId, inv.created_by, { kind: 'invoice.rejected', title: `Invoice ${inv.number} was rejected`, body: comment!, entity_type: 'Invoice', entity_id: id }, session);
    } else if (all.every((s) => s.status === 'approved')) {
      inv.status = assertTransition('in_review', 'approve'); inv.approved_at = new Date();
      await notify(actor.orgId, inv.created_by, { kind: 'invoice.approved', title: `Invoice ${inv.number} is fully approved`, body: 'It can now be added to a payment run.', entity_type: 'Invoice', entity_id: id }, session);
    } else if (inv.approval_mode === 'sequential') {
      const nextStep = all.filter((s) => s.status === 'pending').sort((a, b) => a.step_order - b.step_order)[0];
      if (nextStep) {
        await ApprovalStep.updateOne({ _id: nextStep._id, organisation_id: actor.orgId }, { $set: { activated_at: new Date() } }, { session });
        await notify(actor.orgId, nextStep.approver_id, { kind: 'approval.requested', title: `Approval needed: invoice ${inv.number}`, body: `Step ${nextStep.step_order}`, entity_type: 'Invoice', entity_id: id }, session);
      }
    }
    await inv.save({ session });
    await writeAudit(actor, { action: `invoice.${decision}`, entity_type: 'Invoice', entity_id: id, metadata: { step_order: step.step_order, on_behalf_of: onBehalfOf, comment, status_after: inv.status } }, session);
    return invoiceDto(inv);
  });
}

export async function holdInvoice(actor: Actor, id: string, reason: string) {
  const { inv, steps } = await loadForDecision(actor, id);
  if (!reason || reason.trim().length < 5) throw badRequest('A query or reason of at least 5 characters is required.');
  const sod = await getSod(actor.orgId);
  const self = checkSelfApproval(sod, actor.userId, inv);
  if (self) throw forbidden(self.message, 'SOD_VIOLATION', { rule: self.rule });
  const assigned = steps.some((s) => s.status === 'pending' && String(s.approver_id) === actor.userId);
  if (!assigned && !actor.permissions.has('invoice.view_all')) throw forbidden('You can only hold invoices assigned to you.', 'NOT_ASSIGNED');
  return withTxn(async (session) => {
    inv.status = assertTransition('in_review', 'hold'); inv.hold = { reason, by: actor.userId, at: new Date() };
    await inv.save({ session });
    await InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'query', body: reason }], { session });
    await notify(actor.orgId, inv.created_by, { kind: 'invoice.on_hold', title: `Query on invoice ${inv.number}`, body: reason, entity_type: 'Invoice', entity_id: id }, session);
    await writeAudit(actor, { action: 'invoice.hold', entity_type: 'Invoice', entity_id: id, metadata: { reason } }, session);
    return invoiceDto(inv);
  });
}

export async function resumeInvoice(actor: Actor, id: string, response?: string) {
  const inv: any = await loadVisible(actor, id);
  const mine = String(inv.created_by) === actor.userId;
  if (!actor.permissions.has('invoice.edit_before_approval') && !mine) throw forbidden('Only the Accounts Team or the invoice creator can answer a query.', 'MISSING_PERMISSION');
  if (inv.status !== 'on_hold') throw conflict(`This invoice is ${inv.status}, not on hold.`, 'INVALID_TRANSITION');
  return withTxn(async (session) => {
    inv.status = assertTransition('on_hold', 'resume'); const holder = inv.hold?.by; inv.hold = undefined; await inv.save({ session });
    if (response) await InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'response', body: response }], { session });
    if (holder) await notify(actor.orgId, holder, { kind: 'invoice.resumed', title: `Invoice ${inv.number} is back in review`, body: response || 'The query was answered.', entity_type: 'Invoice', entity_id: id }, session);
    await writeAudit(actor, { action: 'invoice.resume', entity_type: 'Invoice', entity_id: id, metadata: { response } }, session);
    return invoiceDto(inv);
  });
}

export async function reopenInvoice(actor: Actor, id: string) {
  const inv: any = await loadVisible(actor, id);
  const mine = String(inv.created_by) === actor.userId;
  if (!actor.permissions.has('invoice.edit_before_approval') && !mine) throw forbidden('You cannot reopen this invoice.', 'MISSING_PERMISSION');
  if (inv.status !== 'rejected') throw conflict(`Only rejected invoices can be reopened (this one is ${inv.status}).`, 'INVALID_TRANSITION');
  return withTxn(async (session) => {
    inv.status = assertTransition('rejected', 'reopen'); await inv.save({ session });
    await writeAudit(actor, { action: 'invoice.reopened', entity_type: 'Invoice', entity_id: id }, session);
    return invoiceDto(inv);
  });
}

/** My approval work: waiting (directly or by delegation), on hold, and decided. */
export async function approvalQueue(actor: Actor, bucket: 'waiting' | 'on_hold' | 'decided') {
  const now = new Date();
  const dels: any[] = await Delegation.find({ organisation_id: actor.orgId, to_user: actor.userId, revoked_at: null, starts_at: { $lte: now }, ends_at: { $gte: now } }).lean();
  const principals = [actor.userId, ...dels.map((d) => String(d.from_user))];
  let invoiceIds: any[] = [];
  if (bucket === 'decided') invoiceIds = await ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, acted_by: actor.userId });
  else invoiceIds = await ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, approver_id: { $in: principals }, status: 'pending' });
  const statusFilter = bucket === 'waiting' ? 'in_review' : bucket === 'on_hold' ? 'on_hold' : { $in: ['approved', 'rejected', 'scheduled', 'released', 'paid', 'reconciled', 'in_review', 'on_hold'] };
  const invoices: any[] = await Invoice.find({ organisation_id: actor.orgId, _id: { $in: invoiceIds }, status: statusFilter }).sort({ due_date: 1 }).limit(200).lean();
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: invoices.map((i) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v.name]));
  const steps: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: { $in: invoices.map((i) => i._id) } }).lean();
  const out = invoices.map((i) => {
    const mine = steps.filter((s) => String(s.invoice_id) === String(i._id) && s.round === i.approval_round);
    const live = actionableSteps(mine as any, i.approval_mode) as any[];
    const myStep = mine.find((s) => s.status === 'pending' && principals.includes(String(s.approver_id)));
    return { ...invoiceDto(i), vendor_name: vendors.get(String(i.vendor_id)), step_order: myStep?.step_order, steps_total: mine.length, my_turn: bucket === 'waiting' ? live.some((s) => principals.includes(String(s.approver_id))) : false,
      within_limit: actor.user.approval_unlimited || i.total_minor <= (actor.user.approval_limit_minor ?? 0) };
  });
  return bucket === 'waiting' ? out.filter((x) => x.my_turn || true) : out;
}

// ---------------- approval rules
export async function listRules(actor: Actor) { return (await ApprovalRule.find({ organisation_id: actor.orgId }).sort({ priority: -1, min_minor: 1 }).lean()).map(ruleDto); }
export async function saveRule(actor: Actor, id: string | null, input: any) {
  if (input.max_minor !== null && input.max_minor !== undefined && input.max_minor <= input.min_minor) throw badRequest('Maximum amount must be greater than the minimum.');
  for (const r of input.role_ids || []) if (!(await Role.findOne({ _id: r, organisation_id: actor.orgId }).lean())) throw badRequest('A selected role does not exist.');
  for (const u of input.user_ids || []) if (!(await User.findOne({ _id: u, organisation_id: actor.orgId }).lean())) throw badRequest('A selected user does not exist.');
  return withTxn(async (session) => {
    let doc: any; let before: any = null;
    if (id) { doc = await ApprovalRule.findOne({ _id: id, organisation_id: actor.orgId }); if (!doc) throw notFound('Rule'); before = ruleDto(doc); Object.assign(doc, input); await doc.save({ session }); }
    else { [doc] = await ApprovalRule.create([{ ...input, organisation_id: actor.orgId }], { session }); }
    await writeAudit(actor, { action: id ? 'rule.updated' : 'rule.created', entity_type: 'ApprovalRule', entity_id: doc._id, old_values: before, new_values: ruleDto(doc) }, session);
    return ruleDto(doc);
  });
}
export async function deleteRule(actor: Actor, id: string) {
  const d: any = await ApprovalRule.findOne({ _id: id, organisation_id: actor.orgId }); if (!d) throw notFound('Rule');
  await withTxn(async (s) => { await ApprovalRule.deleteOne({ _id: id, organisation_id: actor.orgId }, { session: s }); await writeAudit(actor, { action: 'rule.deleted', entity_type: 'ApprovalRule', entity_id: id, old_values: ruleDto(d) }, s); });
}

/** Background job: pending steps past their escalation window notify the Finance Heads once. */
export async function escalateOverdueSteps() {
  const now = Date.now();
  const steps: any[] = await ApprovalStep.find({ status: 'pending', activated_at: { $ne: null }, escalated_at: null }).setOptions({ skipTenant: true }).limit(500);
  let escalated = 0;
  for (const s of steps) {
    if (now - s.activated_at.getTime() < s.escalation_hours * 3600000) continue;
    const orgId = String(s.organisation_id);
    const inv: any = await Invoice.findOne({ _id: s.invoice_id, organisation_id: orgId, status: 'in_review' }).lean();
    if (!inv) continue;
    const roles = (await Role.find({ organisation_id: orgId, permissions: 'rules.manage' }).lean()).map((r: any) => r._id);
    const heads = (await User.find({ organisation_id: orgId, is_active: true, role_id: { $in: roles } }).lean()).map((u: any) => u._id);
    await withTxn(async (session) => {
      const claimed = await ApprovalStep.findOneAndUpdate({ _id: s._id, organisation_id: orgId, escalated_at: null }, { $set: { escalated_at: new Date() } }, { returnDocument: 'after', session });
      if (!claimed) return;
      await notifyMany(orgId, [s.approver_id, ...heads], { kind: 'approval.overdue', title: `Approval overdue: invoice ${inv.number}`, body: `Waiting more than ${s.escalation_hours} hours.`, entity_type: 'Invoice', entity_id: inv._id }, session);
      await writeAudit({ orgId, userId: null }, { action: 'approval.escalated', entity_type: 'Invoice', entity_id: inv._id, metadata: { step_order: s.step_order, approver_id: s.approver_id } }, session);
      escalated++;
    });
  }
  return { escalated };
}
