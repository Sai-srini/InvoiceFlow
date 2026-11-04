"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const permissions_1 = require("../../domain/permissions");
const policy_1 = require("../../domain/policy");
const stateMachine_1 = require("../../domain/stateMachine");
const approvalMatrix_1 = require("../../domain/approvalMatrix");
const tax_1 = require("../../domain/tax");
(0, node_test_1.default)('permissions: every template only uses known permissions; admin has no financial permissions', () => {
    for (const t of permissions_1.ROLE_TEMPLATES)
        strict_1.default.doesNotThrow(() => (0, permissions_1.validatePermissionList)(t.permissions), t.key);
    const admin = permissions_1.ROLE_TEMPLATES.find((t) => t.key === 'admin');
    strict_1.default.deepEqual([...admin.permissions].sort(), ['org.settings', 'role.manage', 'user.manage']);
    strict_1.default.throws(() => (0, permissions_1.validatePermissionList)(['invoice.approve', 'god.mode']));
    strict_1.default.ok(permissions_1.ALL_PERMISSIONS.length > 30);
});
(0, node_test_1.default)('permissions: no template combines preparing and releasing payment runs', () => {
    for (const t of permissions_1.ROLE_TEMPLATES)
        strict_1.default.ok(!(t.permissions.includes('payment.prepare_run') && t.permissions.includes('payment.release_run')), t.key);
    for (const t of permissions_1.ROLE_TEMPLATES)
        strict_1.default.ok(!(t.permissions.includes('vendor.propose') && t.permissions.includes('vendor.approve')), t.key);
    for (const t of permissions_1.ROLE_TEMPLATES)
        strict_1.default.ok(!(t.permissions.includes('invoice.create') && t.permissions.includes('invoice.approve')), t.key);
});
(0, node_test_1.default)('policy: self approval, limits, release and proposer rules', () => {
    const sod = (0, policy_1.mergeSod)();
    strict_1.default.equal((0, policy_1.checkSelfApproval)(sod, 'u1', { created_by: 'u1' })?.rule, 'no_self_approval');
    strict_1.default.equal((0, policy_1.checkSelfApproval)(sod, 'u1', { created_by: 'u2', edited_by: ['u1'] })?.rule, 'no_self_approval');
    strict_1.default.equal((0, policy_1.checkSelfApproval)(sod, 'u3', { created_by: 'u2', edited_by: ['u1'] }), null);
    strict_1.default.equal((0, policy_1.checkSelfApproval)((0, policy_1.mergeSod)({ no_self_approval: false }), 'u1', { created_by: 'u1' }), null);
    strict_1.default.equal((0, policy_1.checkApprovalLimit)(500000_00, 600000_00)?.rule, 'approval_limit');
    strict_1.default.equal((0, policy_1.checkApprovalLimit)(500000_00, 454300_00), null);
    strict_1.default.equal((0, policy_1.checkApprovalLimit)(null, 9e12), null);
    strict_1.default.equal((0, policy_1.checkRunRelease)(sod, 'p', { prepared_by: 'p' })?.rule, 'run_preparer_cannot_release');
    strict_1.default.equal((0, policy_1.checkRunRelease)(sod, 'r', { prepared_by: 'p', signatures: [{ user_id: 'r' }] })?.rule, 'distinct_signatories');
    strict_1.default.equal((0, policy_1.checkRunRelease)(sod, 'r', { prepared_by: 'p' }), null);
    strict_1.default.equal((0, policy_1.requiredSignatures)(sod, 100), 1);
    strict_1.default.equal((0, policy_1.requiredSignatures)(sod, policy_1.DEFAULT_SOD.dual_release_threshold_minor), 2);
    strict_1.default.equal((0, policy_1.checkProposerApproval)(sod, 'a', 'a')?.rule, 'proposer_cannot_approve');
    strict_1.default.equal((0, policy_1.checkMatchApproval)(sod, 'i', { proposedBy: 'x', importedBy: 'i' })?.rule, 'importer_cannot_approve_match');
    strict_1.default.equal((0, policy_1.checkMatchApproval)(sod, 'y', { proposedBy: 'x', importedBy: 'i' }), null);
});
(0, node_test_1.default)('state machine: only legal actions; no generic jump', () => {
    strict_1.default.equal((0, stateMachine_1.nextStatus)('draft', 'submit'), 'in_review');
    strict_1.default.equal((0, stateMachine_1.nextStatus)('draft', 'approve'), null);
    strict_1.default.equal((0, stateMachine_1.nextStatus)('in_review', 'paid'), null);
    strict_1.default.equal((0, stateMachine_1.nextStatus)('released', 'paid'), 'paid');
    strict_1.default.equal((0, stateMachine_1.nextStatus)('released', 'fail'), 'approved');
    strict_1.default.throws(() => (0, stateMachine_1.assertTransition)('approved', 'reject'));
    strict_1.default.equal((0, stateMachine_1.assertTransition)('on_hold', 'resume'), 'in_review');
    strict_1.default.ok(!('set_status' in stateMachine_1.INVOICE_ACTIONS));
});
const rule = (o) => ({ id: 'r', name: 'R', min_minor: 0, max_minor: null, department: null, cost_centre: null, vendor_category: null,
    approvers_required: 1, mode: 'sequential', role_ids: [], user_ids: [], escalation_hours: 24, priority: 0, is_active: true, ...o });
(0, node_test_1.default)('approval matrix: rule matching by amount, scope, priority and specificity', () => {
    const rules = [
        rule({ id: 'a', name: 'small', min_minor: 0, max_minor: 400000_00 }),
        rule({ id: 'b', name: 'big', min_minor: 400000_00, max_minor: null, approvers_required: 2 }),
        rule({ id: 'c', name: 'packaging big', min_minor: 400000_00, department: 'Packaging', approvers_required: 2 }),
        rule({ id: 'd', name: 'off', min_minor: 0, priority: 99, is_active: false }),
    ];
    strict_1.default.equal((0, approvalMatrix_1.matchRule)(rules, { total_minor: 100_00 })?.id, 'a');
    strict_1.default.equal((0, approvalMatrix_1.matchRule)(rules, { total_minor: 400000_00 })?.id, 'b'); // max is exclusive, min inclusive
    strict_1.default.equal((0, approvalMatrix_1.matchRule)(rules, { total_minor: 454300_00, department: 'Packaging' })?.id, 'c'); // more specific wins
    strict_1.default.equal((0, approvalMatrix_1.matchRule)(rules, { total_minor: 454300_00, department: 'Admin' })?.id, 'b');
    strict_1.default.equal((0, approvalMatrix_1.matchRule)([rule({ min_minor: 10 })], { total_minor: 5 }), null);
});
(0, node_test_1.default)('approval matrix: approvers must cover the full amount, be in scope and not be the creator', () => {
    const c = (id, limit, o = {}) => ({ id, role_id: 'ro', active: true, limit_minor: limit, departments: [], cost_centres: [], can_approve: true, ...o });
    const ctx = { total_minor: 454300_00, department: 'Packaging' };
    const two = rule({ approvers_required: 2 });
    const ok = (0, approvalMatrix_1.chooseApprovers)(two, [c('priya', 500000_00), c('anil', null), c('junior', 100000_00), c('creator', null)], ctx, ['creator']);
    strict_1.default.ok(ok.ok);
    if (ok.ok)
        strict_1.default.deepEqual(ok.steps, [{ user_id: 'priya', step_order: 1 }, { user_id: 'anil', step_order: 2 }]); // ascending limit
    const no = (0, approvalMatrix_1.chooseApprovers)(two, [c('junior', 100000_00), c('anil', null)], ctx, []);
    strict_1.default.equal(no.ok, false);
    strict_1.default.equal((0, approvalMatrix_1.chooseApprovers)(rule({}), [c('x', null, { active: false }), c('y', null, { can_approve: false })], ctx, []).ok, false);
    strict_1.default.equal((0, approvalMatrix_1.chooseApprovers)(rule({}), [c('x', null, { departments: ['Admin'] })], ctx, []).ok, false);
    strict_1.default.equal((0, approvalMatrix_1.chooseApprovers)(rule({ role_ids: ['other'] }), [c('x', null)], ctx, []).ok, false);
    strict_1.default.equal((0, approvalMatrix_1.chooseApprovers)(rule({ user_ids: ['y'] }), [c('x', null), c('y', null)], ctx, []).ok && true, true);
});
(0, node_test_1.default)('approval matrix: sequential steps unlock one at a time, parallel all at once, rejection stops', () => {
    const steps = [{ step_order: 1, status: 'approved' }, { step_order: 2, status: 'pending' }, { step_order: 3, status: 'pending' }];
    strict_1.default.deepEqual((0, approvalMatrix_1.actionableSteps)(steps, 'sequential').map((s) => s.step_order), [2]);
    strict_1.default.deepEqual((0, approvalMatrix_1.actionableSteps)(steps, 'parallel').map((s) => s.step_order), [2, 3]);
    strict_1.default.deepEqual((0, approvalMatrix_1.actionableSteps)([{ step_order: 1, status: 'rejected' }, { step_order: 2, status: 'pending' }], 'sequential'), []);
});
(0, node_test_1.default)('tax: TDS comes only from organisation configuration', () => {
    const sections = [{ section: 'X1', description: 'test', rate_bps: 100, threshold_minor: 30000_00 }];
    strict_1.default.deepEqual((0, tax_1.computeTds)(385000_00, 'X1', sections).amount_minor, 3850_00);
    strict_1.default.equal((0, tax_1.computeTds)(1000_00, 'X1', sections).amount_minor, 0); // under threshold
    strict_1.default.equal((0, tax_1.computeTds)(385000_00, null, sections).amount_minor, 0);
    strict_1.default.throws(() => (0, tax_1.computeTds)(100, 'UNKNOWN', sections));
    strict_1.default.equal((0, tax_1.checkTotals)({ subtotal_minor: 385000_00, cgst_minor: 34650_00, sgst_minor: 34650_00, igst_minor: 0, cess_minor: 0, round_off_minor: 0, total_minor: 454300_00 }).ok, true);
    strict_1.default.equal((0, tax_1.checkTotals)({ subtotal_minor: 100, cgst_minor: 0, sgst_minor: 0, igst_minor: 0, cess_minor: 0, round_off_minor: 0, total_minor: 101 }).ok, false);
});
//# sourceMappingURL=policy_state_matrix.test.js.map