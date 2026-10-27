import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_TEMPLATES, ALL_PERMISSIONS, validatePermissionList } from '../../domain/permissions';
import { DEFAULT_SOD, mergeSod, checkSelfApproval, checkApprovalLimit, checkRunRelease, requiredSignatures, checkProposerApproval, checkMatchApproval } from '../../domain/policy';
import { nextStatus, assertTransition, INVOICE_ACTIONS } from '../../domain/stateMachine';
import { matchRule, chooseApprovers, actionableSteps, Rule, Candidate } from '../../domain/approvalMatrix';
import { computeTds, checkTotals } from '../../domain/tax';

test('permissions: every template only uses known permissions; admin has no financial permissions', () => {
  for (const t of ROLE_TEMPLATES) assert.doesNotThrow(() => validatePermissionList(t.permissions), t.key);
  const admin = ROLE_TEMPLATES.find((t) => t.key === 'admin')!;
  assert.deepEqual([...admin.permissions].sort(), ['org.settings', 'role.manage', 'user.manage']);
  assert.throws(() => validatePermissionList(['invoice.approve', 'god.mode']));
  assert.ok(ALL_PERMISSIONS.length > 30);
});
test('permissions: no template combines preparing and releasing payment runs', () => {
  for (const t of ROLE_TEMPLATES) assert.ok(!(t.permissions.includes('payment.prepare_run') && t.permissions.includes('payment.release_run')), t.key);
  for (const t of ROLE_TEMPLATES) assert.ok(!(t.permissions.includes('vendor.propose') && t.permissions.includes('vendor.approve')), t.key);
  for (const t of ROLE_TEMPLATES) assert.ok(!(t.permissions.includes('invoice.create') && t.permissions.includes('invoice.approve')), t.key);
});
test('policy: self approval, limits, release and proposer rules', () => {
  const sod = mergeSod();
  assert.equal(checkSelfApproval(sod, 'u1', { created_by: 'u1' })?.rule, 'no_self_approval');
  assert.equal(checkSelfApproval(sod, 'u1', { created_by: 'u2', edited_by: ['u1'] })?.rule, 'no_self_approval');
  assert.equal(checkSelfApproval(sod, 'u3', { created_by: 'u2', edited_by: ['u1'] }), null);
  assert.equal(checkSelfApproval(mergeSod({ no_self_approval: false }), 'u1', { created_by: 'u1' }), null);
  assert.equal(checkApprovalLimit(500000_00, 600000_00)?.rule, 'approval_limit');
  assert.equal(checkApprovalLimit(500000_00, 454300_00), null);
  assert.equal(checkApprovalLimit(null, 9e12), null);
  assert.equal(checkRunRelease(sod, 'p', { prepared_by: 'p' })?.rule, 'run_preparer_cannot_release');
  assert.equal(checkRunRelease(sod, 'r', { prepared_by: 'p', signatures: [{ user_id: 'r' }] })?.rule, 'distinct_signatories');
  assert.equal(checkRunRelease(sod, 'r', { prepared_by: 'p' }), null);
  assert.equal(requiredSignatures(sod, 100), 1);
  assert.equal(requiredSignatures(sod, DEFAULT_SOD.dual_release_threshold_minor!), 2);
  assert.equal(checkProposerApproval(sod, 'a', 'a')?.rule, 'proposer_cannot_approve');
  assert.equal(checkMatchApproval(sod, 'i', { proposedBy: 'x', importedBy: 'i' })?.rule, 'importer_cannot_approve_match');
  assert.equal(checkMatchApproval(sod, 'y', { proposedBy: 'x', importedBy: 'i' }), null);
});
test('state machine: only legal actions; no generic jump', () => {
  assert.equal(nextStatus('draft', 'submit'), 'in_review');
  assert.equal(nextStatus('draft', 'approve'), null);
  assert.equal(nextStatus('in_review', 'paid'), null);
  assert.equal(nextStatus('released', 'paid'), 'paid');
  assert.equal(nextStatus('released', 'fail'), 'approved');
  assert.throws(() => assertTransition('approved', 'reject'));
  assert.equal(assertTransition('on_hold', 'resume'), 'in_review');
  assert.ok(!('set_status' in INVOICE_ACTIONS));
});

const rule = (o: Partial<Rule>): Rule => ({ id: 'r', name: 'R', min_minor: 0, max_minor: null, department: null, cost_centre: null, vendor_category: null,
  approvers_required: 1, mode: 'sequential', role_ids: [], user_ids: [], escalation_hours: 24, priority: 0, is_active: true, ...o });
test('approval matrix: rule matching by amount, scope, priority and specificity', () => {
  const rules = [
    rule({ id: 'a', name: 'small', min_minor: 0, max_minor: 400000_00 }),
    rule({ id: 'b', name: 'big', min_minor: 400000_00, max_minor: null, approvers_required: 2 }),
    rule({ id: 'c', name: 'packaging big', min_minor: 400000_00, department: 'Packaging', approvers_required: 2 }),
    rule({ id: 'd', name: 'off', min_minor: 0, priority: 99, is_active: false }),
  ];
  assert.equal(matchRule(rules, { total_minor: 100_00 })?.id, 'a');
  assert.equal(matchRule(rules, { total_minor: 400000_00 })?.id, 'b');          // max is exclusive, min inclusive
  assert.equal(matchRule(rules, { total_minor: 454300_00, department: 'Packaging' })?.id, 'c'); // more specific wins
  assert.equal(matchRule(rules, { total_minor: 454300_00, department: 'Admin' })?.id, 'b');
  assert.equal(matchRule([rule({ min_minor: 10 })], { total_minor: 5 }), null);
});
test('approval matrix: approvers must cover the full amount, be in scope and not be the creator', () => {
  const c = (id: string, limit: number | null, o: Partial<Candidate> = {}): Candidate => ({ id, role_id: 'ro', active: true, limit_minor: limit, departments: [], cost_centres: [], can_approve: true, ...o });
  const ctx = { total_minor: 454300_00, department: 'Packaging' };
  const two = rule({ approvers_required: 2 });
  const ok = chooseApprovers(two, [c('priya', 500000_00), c('anil', null), c('junior', 100000_00), c('creator', null)], ctx, ['creator']);
  assert.ok(ok.ok); if (ok.ok) assert.deepEqual(ok.steps, [{ user_id: 'priya', step_order: 1 }, { user_id: 'anil', step_order: 2 }]); // ascending limit
  const no = chooseApprovers(two, [c('junior', 100000_00), c('anil', null)], ctx, []);
  assert.equal(no.ok, false);
  assert.equal(chooseApprovers(rule({}), [c('x', null, { active: false }), c('y', null, { can_approve: false })], ctx, []).ok, false);
  assert.equal(chooseApprovers(rule({}), [c('x', null, { departments: ['Admin'] })], ctx, []).ok, false);
  assert.equal(chooseApprovers(rule({ role_ids: ['other'] }), [c('x', null)], ctx, []).ok, false);
  assert.equal(chooseApprovers(rule({ user_ids: ['y'] }), [c('x', null), c('y', null)], ctx, []).ok && true, true);
});
test('approval matrix: sequential steps unlock one at a time, parallel all at once, rejection stops', () => {
  const steps = [{ step_order: 1, status: 'approved' }, { step_order: 2, status: 'pending' }, { step_order: 3, status: 'pending' }];
  assert.deepEqual(actionableSteps(steps, 'sequential').map((s) => s.step_order), [2]);
  assert.deepEqual(actionableSteps(steps, 'parallel').map((s) => s.step_order), [2, 3]);
  assert.deepEqual(actionableSteps([{ step_order: 1, status: 'rejected' }, { step_order: 2, status: 'pending' }], 'sequential'), []);
});
test('tax: TDS comes only from organisation configuration', () => {
  const sections = [{ section: 'X1', description: 'test', rate_bps: 100, threshold_minor: 30000_00 }];
  assert.deepEqual(computeTds(385000_00, 'X1', sections).amount_minor, 3850_00);
  assert.equal(computeTds(1000_00, 'X1', sections).amount_minor, 0);       // under threshold
  assert.equal(computeTds(385000_00, null, sections).amount_minor, 0);
  assert.throws(() => computeTds(100, 'UNKNOWN', sections));
  assert.equal(checkTotals({ subtotal_minor: 385000_00, cgst_minor: 34650_00, sgst_minor: 34650_00, igst_minor: 0, cess_minor: 0, round_off_minor: 0, total_minor: 454300_00 }).ok, true);
  assert.equal(checkTotals({ subtotal_minor: 100, cgst_minor: 0, sgst_minor: 0, igst_minor: 0, cess_minor: 0, round_off_minor: 0, total_minor: 101 }).ok, false);
});
