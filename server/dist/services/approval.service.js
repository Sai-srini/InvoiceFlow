"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleDto = void 0;
exports.submitInvoice = submitInvoice;
exports.decide = decide;
exports.holdInvoice = holdInvoice;
exports.resumeInvoice = resumeInvoice;
exports.reopenInvoice = reopenInvoice;
exports.approvalQueue = approvalQueue;
exports.listRules = listRules;
exports.saveRule = saveRule;
exports.deleteRule = deleteRule;
exports.escalateOverdueSteps = escalateOverdueSteps;
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const stateMachine_1 = require("../domain/stateMachine");
const approvalMatrix_1 = require("../domain/approvalMatrix");
const policy_1 = require("../domain/policy");
const org_service_1 = require("./org.service");
const notification_service_1 = require("./notification.service");
const invoice_service_1 = require("./invoice.service");
const toRule = (r) => ({ id: String(r._id), name: r.name, min_minor: r.min_minor, max_minor: r.max_minor ?? null, department: r.department || null, cost_centre: r.cost_centre || null,
    vendor_category: r.vendor_category || null, approvers_required: r.approvers_required, mode: r.mode, role_ids: (r.role_ids || []).map(String), user_ids: (r.user_ids || []).map(String),
    escalation_hours: r.escalation_hours, priority: r.priority, is_active: r.is_active });
const ruleDto = (r) => ({ ...toRule(r), createdAt: r.createdAt });
exports.ruleDto = ruleDto;
async function candidates(orgId) {
    const roles = await models_1.Role.find({ organisation_id: orgId, permissions: 'invoice.approve' }).lean();
    const ids = roles.map((r) => r._id);
    const users = await models_1.User.find({ organisation_id: orgId, is_active: true, role_id: { $in: ids } }).lean();
    return users.map((u) => ({ id: String(u._id), role_id: String(u.role_id), active: u.is_active, limit_minor: u.approval_unlimited ? null : (u.approval_limit_minor ?? 0),
        departments: u.departments || [], cost_centres: u.cost_centres || [], can_approve: true }));
}
/** Draft -> in_review. Picks the approval rule and approvers; fails clearly when nobody is eligible. */
async function submitInvoice(actor, id) {
    const inv = await (0, invoice_service_1.loadVisible)(actor, id);
    const mine = String(inv.created_by) === actor.userId;
    if (!actor.permissions.has('invoice.edit_before_approval') && !(mine && actor.permissions.has('invoice.create_own')))
        throw (0, errors_1.forbidden)('You cannot submit this invoice.', 'MISSING_PERMISSION');
    const next = (() => { try {
        return (0, stateMachine_1.assertTransition)(inv.status, 'submit');
    }
    catch (e) {
        throw (0, errors_1.conflict)(e.message, 'INVALID_TRANSITION');
    } })();
    const vendor = await models_1.Vendor.findOne({ _id: inv.vendor_id, organisation_id: actor.orgId }).lean();
    if (!vendor || vendor.status !== 'active')
        throw (0, errors_1.conflict)('The vendor must be approved and active before an invoice can be submitted.', 'VENDOR_NOT_ACTIVE');
    if (!vendor.bank?.account_number_enc)
        throw (0, errors_1.conflict)('The vendor has no bank details on file.', 'VENDOR_NO_BANK');
    const rules = (await models_1.ApprovalRule.find({ organisation_id: actor.orgId, is_active: true }).lean()).map(toRule);
    const rule = (0, approvalMatrix_1.matchRule)(rules, { total_minor: inv.total_minor, department: inv.department, cost_centre: inv.cost_centre, vendor_category: vendor.category });
    if (!rule)
        throw (0, errors_1.conflict)('No approval rule matches this invoice. Ask a Finance Head to add one.', 'NO_APPROVAL_RULE');
    const exclude = [String(inv.created_by), ...(inv.edited_by || []).map(String), actor.userId];
    const choice = (0, approvalMatrix_1.chooseApprovers)(rule, await candidates(actor.orgId), { total_minor: inv.total_minor, department: inv.department, cost_centre: inv.cost_centre }, exclude);
    if (choice.ok === false)
        throw (0, errors_1.conflict)(choice.reason, 'NO_ELIGIBLE_APPROVERS');
    const picked = choice.steps;
    return (0, txn_1.withTxn)(async (session) => {
        const round = (inv.approval_round || 0) + 1;
        const now = new Date();
        await models_1.ApprovalStep.create(picked.map((s) => ({ organisation_id: actor.orgId, invoice_id: inv._id, approver_id: s.user_id, step_order: s.step_order, round, status: 'pending',
            activated_at: rule.mode === 'parallel' || s.step_order === 1 ? now : null, escalation_hours: rule.escalation_hours })), { session, ordered: true });
        inv.status = next;
        inv.rule_id = rule.id;
        inv.rule_name = rule.name;
        inv.approval_mode = rule.mode;
        inv.approval_round = round;
        inv.submitted_at = now;
        inv.hold = undefined;
        inv.rejection = undefined;
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.submitted', entity_type: 'Invoice', entity_id: id, new_values: { rule: rule.name, approvers: picked.map((s) => s.user_id), mode: rule.mode } }, session);
        const first = rule.mode === 'parallel' ? picked : picked.filter((s) => s.step_order === 1);
        await (0, notification_service_1.notifyMany)(actor.orgId, first.map((s) => s.user_id), { kind: 'approval.requested', title: `Approval needed: invoice ${inv.number}`, body: `${vendor.name} · ${inv.total_minor / 100}`, entity_type: 'Invoice', entity_id: id }, session);
        return (0, invoice_service_1.invoiceDto)(inv);
    });
}
/** A step belongs to the actor directly, or through an active delegation from the assigned approver. */
async function findActorStep(actor, invoice, steps) {
    const live = (0, approvalMatrix_1.actionableSteps)(steps, invoice.approval_mode);
    const now = new Date();
    const delegations = await models_1.Delegation.find({ organisation_id: actor.orgId, to_user: actor.userId, revoked_at: null, starts_at: { $lte: now }, ends_at: { $gte: now } }).lean();
    const principals = new Set(delegations.map((d) => String(d.from_user)));
    const own = live.find((s) => String(s.approver_id) === actor.userId);
    if (own)
        return { step: own, onBehalfOf: null };
    const del = live.find((s) => principals.has(String(s.approver_id)));
    if (del)
        return { step: del, onBehalfOf: String(del.approver_id) };
    const assigned = steps.find((s) => s.status === 'pending' && (String(s.approver_id) === actor.userId || principals.has(String(s.approver_id))));
    if (assigned)
        throw (0, errors_1.conflict)('This invoice is not waiting for you yet. An earlier approval step must be completed first.', 'NOT_YOUR_TURN');
    throw (0, errors_1.forbidden)('This invoice is not assigned to you.', 'NOT_ASSIGNED');
}
async function loadForDecision(actor, id) {
    const inv = await (0, invoice_service_1.loadVisible)(actor, id);
    if (inv.status !== 'in_review')
        throw (0, errors_1.conflict)(`This invoice is ${inv.status}, so it cannot be decided.`, 'INVALID_TRANSITION');
    const steps = await models_1.ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round });
    return { inv, steps };
}
async function decide(actor, id, decision, comment) {
    const { inv, steps } = await loadForDecision(actor, id);
    const sod = await (0, org_service_1.getSod)(actor.orgId);
    const self = (0, policy_1.checkSelfApproval)(sod, actor.userId, inv);
    if (self)
        throw (0, errors_1.forbidden)(self.message, 'SOD_VIOLATION', { rule: self.rule });
    const { step, onBehalfOf } = await findActorStep(actor, inv, steps);
    const u = actor.user;
    const lim = (0, policy_1.checkApprovalLimit)(u.approval_unlimited ? null : (u.approval_limit_minor ?? 0), inv.total_minor);
    if (decision === 'approve' && lim)
        throw (0, errors_1.forbidden)(lim.message, 'APPROVAL_LIMIT', { rule: lim.rule, invoice_total_minor: inv.total_minor });
    if (decision === 'reject' && (!comment || comment.trim().length < 5))
        throw (0, errors_1.badRequest)('A reason of at least 5 characters is required to reject.');
    return (0, txn_1.withTxn)(async (session) => {
        const fresh = await models_1.ApprovalStep.findOneAndUpdate({ _id: step._id, organisation_id: actor.orgId, status: 'pending' }, { $set: { status: decision === 'approve' ? 'approved' : 'rejected', acted_by: actor.userId, on_behalf_of: onBehalfOf, comment, decided_at: new Date() } }, { returnDocument: 'after', session });
        if (!fresh)
            throw (0, errors_1.conflict)('This step has already been decided.', 'ALREADY_DECIDED');
        if (comment)
            await models_1.InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'decision', body: comment }], { session });
        const all = await models_1.ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round }).session(session || null);
        if (decision === 'reject') {
            await models_1.ApprovalStep.updateMany({ organisation_id: actor.orgId, invoice_id: id, round: inv.approval_round, status: 'pending' }, { $set: { status: 'cancelled' } }, { session });
            inv.status = (0, stateMachine_1.assertTransition)('in_review', 'reject');
            inv.rejection = { reason: comment, by: actor.userId, at: new Date() };
            await (0, notification_service_1.notify)(actor.orgId, inv.created_by, { kind: 'invoice.rejected', title: `Invoice ${inv.number} was rejected`, body: comment, entity_type: 'Invoice', entity_id: id }, session);
        }
        else if (all.every((s) => s.status === 'approved')) {
            inv.status = (0, stateMachine_1.assertTransition)('in_review', 'approve');
            inv.approved_at = new Date();
            await (0, notification_service_1.notify)(actor.orgId, inv.created_by, { kind: 'invoice.approved', title: `Invoice ${inv.number} is fully approved`, body: 'It can now be added to a payment run.', entity_type: 'Invoice', entity_id: id }, session);
        }
        else if (inv.approval_mode === 'sequential') {
            const nextStep = all.filter((s) => s.status === 'pending').sort((a, b) => a.step_order - b.step_order)[0];
            if (nextStep) {
                await models_1.ApprovalStep.updateOne({ _id: nextStep._id, organisation_id: actor.orgId }, { $set: { activated_at: new Date() } }, { session });
                await (0, notification_service_1.notify)(actor.orgId, nextStep.approver_id, { kind: 'approval.requested', title: `Approval needed: invoice ${inv.number}`, body: `Step ${nextStep.step_order}`, entity_type: 'Invoice', entity_id: id }, session);
            }
        }
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: `invoice.${decision}`, entity_type: 'Invoice', entity_id: id, metadata: { step_order: step.step_order, on_behalf_of: onBehalfOf, comment, status_after: inv.status } }, session);
        return (0, invoice_service_1.invoiceDto)(inv);
    });
}
async function holdInvoice(actor, id, reason) {
    const { inv, steps } = await loadForDecision(actor, id);
    if (!reason || reason.trim().length < 5)
        throw (0, errors_1.badRequest)('A query or reason of at least 5 characters is required.');
    const sod = await (0, org_service_1.getSod)(actor.orgId);
    const self = (0, policy_1.checkSelfApproval)(sod, actor.userId, inv);
    if (self)
        throw (0, errors_1.forbidden)(self.message, 'SOD_VIOLATION', { rule: self.rule });
    const assigned = steps.some((s) => s.status === 'pending' && String(s.approver_id) === actor.userId);
    if (!assigned && !actor.permissions.has('invoice.view_all'))
        throw (0, errors_1.forbidden)('You can only hold invoices assigned to you.', 'NOT_ASSIGNED');
    return (0, txn_1.withTxn)(async (session) => {
        inv.status = (0, stateMachine_1.assertTransition)('in_review', 'hold');
        inv.hold = { reason, by: actor.userId, at: new Date() };
        await inv.save({ session });
        await models_1.InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'query', body: reason }], { session });
        await (0, notification_service_1.notify)(actor.orgId, inv.created_by, { kind: 'invoice.on_hold', title: `Query on invoice ${inv.number}`, body: reason, entity_type: 'Invoice', entity_id: id }, session);
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.hold', entity_type: 'Invoice', entity_id: id, metadata: { reason } }, session);
        return (0, invoice_service_1.invoiceDto)(inv);
    });
}
async function resumeInvoice(actor, id, response) {
    const inv = await (0, invoice_service_1.loadVisible)(actor, id);
    const mine = String(inv.created_by) === actor.userId;
    if (!actor.permissions.has('invoice.edit_before_approval') && !mine)
        throw (0, errors_1.forbidden)('Only the Accounts Team or the invoice creator can answer a query.', 'MISSING_PERMISSION');
    if (inv.status !== 'on_hold')
        throw (0, errors_1.conflict)(`This invoice is ${inv.status}, not on hold.`, 'INVALID_TRANSITION');
    return (0, txn_1.withTxn)(async (session) => {
        inv.status = (0, stateMachine_1.assertTransition)('on_hold', 'resume');
        const holder = inv.hold?.by;
        inv.hold = undefined;
        await inv.save({ session });
        if (response)
            await models_1.InvoiceComment.create([{ organisation_id: actor.orgId, invoice_id: inv._id, author_id: actor.userId, kind: 'response', body: response }], { session });
        if (holder)
            await (0, notification_service_1.notify)(actor.orgId, holder, { kind: 'invoice.resumed', title: `Invoice ${inv.number} is back in review`, body: response || 'The query was answered.', entity_type: 'Invoice', entity_id: id }, session);
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.resume', entity_type: 'Invoice', entity_id: id, metadata: { response } }, session);
        return (0, invoice_service_1.invoiceDto)(inv);
    });
}
async function reopenInvoice(actor, id) {
    const inv = await (0, invoice_service_1.loadVisible)(actor, id);
    const mine = String(inv.created_by) === actor.userId;
    if (!actor.permissions.has('invoice.edit_before_approval') && !mine)
        throw (0, errors_1.forbidden)('You cannot reopen this invoice.', 'MISSING_PERMISSION');
    if (inv.status !== 'rejected')
        throw (0, errors_1.conflict)(`Only rejected invoices can be reopened (this one is ${inv.status}).`, 'INVALID_TRANSITION');
    return (0, txn_1.withTxn)(async (session) => {
        inv.status = (0, stateMachine_1.assertTransition)('rejected', 'reopen');
        await inv.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'invoice.reopened', entity_type: 'Invoice', entity_id: id }, session);
        return (0, invoice_service_1.invoiceDto)(inv);
    });
}
/** My approval work: waiting (directly or by delegation), on hold, and decided. */
async function approvalQueue(actor, bucket) {
    const now = new Date();
    const dels = await models_1.Delegation.find({ organisation_id: actor.orgId, to_user: actor.userId, revoked_at: null, starts_at: { $lte: now }, ends_at: { $gte: now } }).lean();
    const principals = [actor.userId, ...dels.map((d) => String(d.from_user))];
    let invoiceIds = [];
    if (bucket === 'decided')
        invoiceIds = await models_1.ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, acted_by: actor.userId });
    else
        invoiceIds = await models_1.ApprovalStep.distinct('invoice_id', { organisation_id: actor.orgId, approver_id: { $in: principals }, status: 'pending' });
    const statusFilter = bucket === 'waiting' ? 'in_review' : bucket === 'on_hold' ? 'on_hold' : { $in: ['approved', 'rejected', 'scheduled', 'released', 'paid', 'reconciled', 'in_review', 'on_hold'] };
    const invoices = await models_1.Invoice.find({ organisation_id: actor.orgId, _id: { $in: invoiceIds }, status: statusFilter }).sort({ due_date: 1 }).limit(200).lean();
    const vendors = new Map((await models_1.Vendor.find({ organisation_id: actor.orgId, _id: { $in: invoices.map((i) => i.vendor_id) } }).lean()).map((v) => [String(v._id), v.name]));
    const steps = await models_1.ApprovalStep.find({ organisation_id: actor.orgId, invoice_id: { $in: invoices.map((i) => i._id) } }).lean();
    const out = invoices.map((i) => {
        const mine = steps.filter((s) => String(s.invoice_id) === String(i._id) && s.round === i.approval_round);
        const live = (0, approvalMatrix_1.actionableSteps)(mine, i.approval_mode);
        const myStep = mine.find((s) => s.status === 'pending' && principals.includes(String(s.approver_id)));
        return { ...(0, invoice_service_1.invoiceDto)(i), vendor_name: vendors.get(String(i.vendor_id)), step_order: myStep?.step_order, steps_total: mine.length, my_turn: bucket === 'waiting' ? live.some((s) => principals.includes(String(s.approver_id))) : false,
            within_limit: actor.user.approval_unlimited || i.total_minor <= (actor.user.approval_limit_minor ?? 0) };
    });
    return bucket === 'waiting' ? out.filter((x) => x.my_turn || true) : out;
}
// ---------------- approval rules
async function listRules(actor) { return (await models_1.ApprovalRule.find({ organisation_id: actor.orgId }).sort({ priority: -1, min_minor: 1 }).lean()).map(exports.ruleDto); }
async function saveRule(actor, id, input) {
    if (input.max_minor !== null && input.max_minor !== undefined && input.max_minor <= input.min_minor)
        throw (0, errors_1.badRequest)('Maximum amount must be greater than the minimum.');
    for (const r of input.role_ids || [])
        if (!(await models_1.Role.findOne({ _id: r, organisation_id: actor.orgId }).lean()))
            throw (0, errors_1.badRequest)('A selected role does not exist.');
    for (const u of input.user_ids || [])
        if (!(await models_1.User.findOne({ _id: u, organisation_id: actor.orgId }).lean()))
            throw (0, errors_1.badRequest)('A selected user does not exist.');
    return (0, txn_1.withTxn)(async (session) => {
        let doc;
        let before = null;
        if (id) {
            doc = await models_1.ApprovalRule.findOne({ _id: id, organisation_id: actor.orgId });
            if (!doc)
                throw (0, errors_1.notFound)('Rule');
            before = (0, exports.ruleDto)(doc);
            Object.assign(doc, input);
            await doc.save({ session });
        }
        else {
            [doc] = await models_1.ApprovalRule.create([{ ...input, organisation_id: actor.orgId }], { session });
        }
        await (0, audit_service_1.writeAudit)(actor, { action: id ? 'rule.updated' : 'rule.created', entity_type: 'ApprovalRule', entity_id: doc._id, old_values: before, new_values: (0, exports.ruleDto)(doc) }, session);
        return (0, exports.ruleDto)(doc);
    });
}
async function deleteRule(actor, id) {
    const d = await models_1.ApprovalRule.findOne({ _id: id, organisation_id: actor.orgId });
    if (!d)
        throw (0, errors_1.notFound)('Rule');
    await (0, txn_1.withTxn)(async (s) => { await models_1.ApprovalRule.deleteOne({ _id: id, organisation_id: actor.orgId }, { session: s }); await (0, audit_service_1.writeAudit)(actor, { action: 'rule.deleted', entity_type: 'ApprovalRule', entity_id: id, old_values: (0, exports.ruleDto)(d) }, s); });
}
/** Background job: pending steps past their escalation window notify the Finance Heads once. */
async function escalateOverdueSteps() {
    const now = Date.now();
    const steps = await models_1.ApprovalStep.find({ status: 'pending', activated_at: { $ne: null }, escalated_at: null }).setOptions({ skipTenant: true }).limit(500);
    let escalated = 0;
    for (const s of steps) {
        if (now - s.activated_at.getTime() < s.escalation_hours * 3600000)
            continue;
        const orgId = String(s.organisation_id);
        const inv = await models_1.Invoice.findOne({ _id: s.invoice_id, organisation_id: orgId, status: 'in_review' }).lean();
        if (!inv)
            continue;
        const roles = (await models_1.Role.find({ organisation_id: orgId, permissions: 'rules.manage' }).lean()).map((r) => r._id);
        const heads = (await models_1.User.find({ organisation_id: orgId, is_active: true, role_id: { $in: roles } }).lean()).map((u) => u._id);
        await (0, txn_1.withTxn)(async (session) => {
            const claimed = await models_1.ApprovalStep.findOneAndUpdate({ _id: s._id, organisation_id: orgId, escalated_at: null }, { $set: { escalated_at: new Date() } }, { returnDocument: 'after', session });
            if (!claimed)
                return;
            await (0, notification_service_1.notifyMany)(orgId, [s.approver_id, ...heads], { kind: 'approval.overdue', title: `Approval overdue: invoice ${inv.number}`, body: `Waiting more than ${s.escalation_hours} hours.`, entity_type: 'Invoice', entity_id: inv._id }, session);
            await (0, audit_service_1.writeAudit)({ orgId, userId: null }, { action: 'approval.escalated', entity_type: 'Invoice', entity_id: inv._id, metadata: { step_order: s.step_order, approver_id: s.approver_id } }, session);
            escalated++;
        });
    }
    return { escalated };
}
//# sourceMappingURL=approval.service.js.map