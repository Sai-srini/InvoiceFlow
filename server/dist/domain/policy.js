"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeSod = exports.DEFAULT_SOD = void 0;
exports.checkSelfApproval = checkSelfApproval;
exports.checkApprovalLimit = checkApprovalLimit;
exports.checkRunRelease = checkRunRelease;
exports.requiredSignatures = requiredSignatures;
exports.checkProposerApproval = checkProposerApproval;
exports.checkMatchApproval = checkMatchApproval;
exports.DEFAULT_SOD = {
    no_self_approval: true,
    run_preparer_cannot_release: true,
    proposer_cannot_approve: true,
    importer_cannot_approve_match: true,
    dual_release_threshold_minor: 2500000_00, // ₹25,00,000
    dual_approval_threshold_minor: null,
};
const mergeSod = (s) => ({ ...exports.DEFAULT_SOD, ...(s || {}) });
exports.mergeSod = mergeSod;
function checkSelfApproval(sod, actorId, invoice) {
    if (!sod.no_self_approval)
        return null;
    const touched = [String(invoice.created_by), ...(invoice.edited_by || []).map(String)];
    return touched.includes(String(actorId))
        ? { rule: 'no_self_approval', message: 'You created or edited this invoice, so you cannot approve or reject it.' }
        : null;
}
function checkApprovalLimit(limitMinor, amountMinor) {
    if (limitMinor === null || limitMinor === undefined)
        return null; // null = unlimited
    return amountMinor > limitMinor
        ? { rule: 'approval_limit', message: 'This invoice is above your approval limit.' }
        : null;
}
function checkRunRelease(sod, actorId, run) {
    if (sod.run_preparer_cannot_release && String(run.prepared_by) === String(actorId))
        return { rule: 'run_preparer_cannot_release', message: 'You prepared this payment run, so you cannot release it.' };
    if ((run.signatures || []).some((s) => String(s.user_id) === String(actorId)))
        return { rule: 'distinct_signatories', message: 'You have already signed this release. A different person must give the second signature.' };
    return null;
}
function requiredSignatures(sod, runNetMinor) {
    return sod.dual_release_threshold_minor !== null && runNetMinor >= sod.dual_release_threshold_minor ? 2 : 1;
}
function checkProposerApproval(sod, actorId, proposedBy) {
    return sod.proposer_cannot_approve && String(proposedBy) === String(actorId)
        ? { rule: 'proposer_cannot_approve', message: 'You proposed this change, so someone else must approve it.' }
        : null;
}
function checkMatchApproval(sod, actorId, ctx) {
    if (String(ctx.proposedBy) === String(actorId))
        return { rule: 'proposer_cannot_approve', message: 'You proposed this match, so someone else must approve it.' };
    if (sod.importer_cannot_approve_match && ctx.importedBy && String(ctx.importedBy) === String(actorId))
        return { rule: 'importer_cannot_approve_match', message: 'You imported this statement, so you cannot approve manual matches on it.' };
    return null;
}
//# sourceMappingURL=policy.js.map