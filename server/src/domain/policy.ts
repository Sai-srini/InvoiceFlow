// Segregation-of-duties and limit checks. PURE functions: every rule lives here, nowhere else.
export interface SodSettings {
  no_self_approval: boolean;            // creator/editor cannot approve their own invoice
  run_preparer_cannot_release: boolean; // preparer of a payment run cannot sign its release
  proposer_cannot_approve: boolean;     // vendor / bank-change proposer cannot approve it
  importer_cannot_approve_match: boolean; // statement importer cannot approve manual matches on it
  dual_release_threshold_minor: number | null; // net run total at/above which two distinct signatories are needed
  dual_approval_threshold_minor: number | null; // informational default for new rules
}
export const DEFAULT_SOD: SodSettings = {
  no_self_approval: true,
  run_preparer_cannot_release: true,
  proposer_cannot_approve: true,
  importer_cannot_approve_match: true,
  dual_release_threshold_minor: 2500000_00, // ₹25,00,000
  dual_approval_threshold_minor: null,
};

export interface Violation { rule: string; message: string; }
export const mergeSod = (s?: Partial<SodSettings> | null): SodSettings => ({ ...DEFAULT_SOD, ...(s || {}) });

export function checkSelfApproval(sod: SodSettings, actorId: string, invoice: { created_by: any; edited_by?: any[] }): Violation | null {
  if (!sod.no_self_approval) return null;
  const touched = [String(invoice.created_by), ...(invoice.edited_by || []).map(String)];
  return touched.includes(String(actorId))
    ? { rule: 'no_self_approval', message: 'You created or edited this invoice, so you cannot approve or reject it.' }
    : null;
}

export function checkApprovalLimit(limitMinor: number | null | undefined, amountMinor: number): Violation | null {
  if (limitMinor === null || limitMinor === undefined) return null; // null = unlimited
  return amountMinor > limitMinor
    ? { rule: 'approval_limit', message: 'This invoice is above your approval limit.' }
    : null;
}

export function checkRunRelease(sod: SodSettings, actorId: string, run: { prepared_by: any; signatures?: { user_id: any }[] }): Violation | null {
  if (sod.run_preparer_cannot_release && String(run.prepared_by) === String(actorId))
    return { rule: 'run_preparer_cannot_release', message: 'You prepared this payment run, so you cannot release it.' };
  if ((run.signatures || []).some((s) => String(s.user_id) === String(actorId)))
    return { rule: 'distinct_signatories', message: 'You have already signed this release. A different person must give the second signature.' };
  return null;
}

export function requiredSignatures(sod: SodSettings, runNetMinor: number): number {
  return sod.dual_release_threshold_minor !== null && runNetMinor >= sod.dual_release_threshold_minor ? 2 : 1;
}

export function checkProposerApproval(sod: SodSettings, actorId: string, proposedBy: any): Violation | null {
  return sod.proposer_cannot_approve && String(proposedBy) === String(actorId)
    ? { rule: 'proposer_cannot_approve', message: 'You proposed this change, so someone else must approve it.' }
    : null;
}

export function checkMatchApproval(sod: SodSettings, actorId: string, ctx: { proposedBy: any; importedBy: any }): Violation | null {
  if (String(ctx.proposedBy) === String(actorId))
    return { rule: 'proposer_cannot_approve', message: 'You proposed this match, so someone else must approve it.' };
  if (sod.importer_cannot_approve_match && ctx.importedBy && String(ctx.importedBy) === String(actorId))
    return { rule: 'importer_cannot_approve_match', message: 'You imported this statement, so you cannot approve manual matches on it.' };
  return null;
}
