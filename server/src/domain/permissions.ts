// Permission catalogue. The backend authorises on PERMISSIONS, never on role names.
export const PERMISSIONS = {
  'invoice.create_own': 'Create invoices (own only)',
  'invoice.view_own': 'View invoices you created',
  'invoice.view_assigned': 'View invoices assigned to you for approval',
  'invoice.view_all': 'View all invoices in the organisation',
  'invoice.create': 'Create invoices on behalf of the organisation',
  'invoice.edit_before_approval': 'Edit invoices while draft or on hold',
  'invoice.upload': 'Upload invoice documents',
  'invoice.review_extraction': 'Review extracted invoice data',
  'invoice.approve': 'Approve invoices (within approval limit)',
  'invoice.reject': 'Reject invoices',
  'invoice.hold': 'Put invoices on hold with a query',
  'invoice.comment': 'Comment on invoices',
  'vendor.view': 'View vendors',
  'vendor.propose': 'Propose new vendors',
  'vendor.approve': 'Approve new vendors',
  'vendor.bank_change.propose': 'Propose vendor bank detail changes',
  'vendor.bank_change.approve': 'Approve vendor bank detail changes',
  'vendor.bank_reveal': 'Reveal full vendor bank account numbers',
  'payment.view': 'View payments and payment runs',
  'payment.prepare_run': 'Prepare payment runs',
  'payment.release_run': 'Release payment runs',
  'payment.hold': 'Hold individual payments',
  'payment.release_hold': 'Release held payments',
  'payment.confirm_paid': 'Confirm payments as paid / failed with a bank reference',
  'bank.view': 'View bank statements and reconciliation',
  'bank.configure': 'Manage bank accounts and statement mapping profiles',
  'bank.import': 'Import bank statements',
  'bank.reconcile': 'Match and reconcile statement lines',
  'bank.approve_manual_match': 'Approve manual reconciliation matches',
  'rules.manage': 'Manage approval rules and limits',
  'tax.configure': 'Configure tax (TDS) settings',
  'report.view_own': 'View own reports',
  'report.view_ops': 'View operational reports',
  'report.view_all': 'View all reports',
  'audit.view': 'View the audit log',
  'audit.export': 'Export the audit log',
  'user.manage': 'Manage users, invitations and delegation',
  'role.manage': 'Manage roles',
  'org.settings': 'Manage organisation settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const isPermission = (p: string): p is Permission => p in PERMISSIONS;

export interface RoleTemplate { key: string; name: string; description: string; permissions: Permission[]; }

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'requester', name: 'Requester', description: 'Any employee who raises bills for payment.',
    permissions: ['invoice.create_own', 'invoice.view_own', 'invoice.comment'] },
  { key: 'accounts_team', name: 'Accounts Team', description: 'Captures and codes invoices, prepares payment runs, imports bank statements.',
    permissions: ['invoice.create', 'invoice.edit_before_approval', 'invoice.upload', 'invoice.review_extraction', 'invoice.view_all', 'invoice.comment',
      'vendor.view', 'vendor.propose', 'vendor.bank_change.propose', 'payment.view', 'payment.prepare_run', 'payment.hold',
      'bank.view', 'bank.configure', 'bank.import', 'bank.reconcile', 'report.view_ops'] },
  { key: 'approver', name: 'Approver', description: 'Approves or rejects invoices assigned to them within their limit.',
    permissions: ['invoice.view_assigned', 'invoice.approve', 'invoice.reject', 'invoice.hold', 'invoice.comment', 'vendor.view', 'report.view_own'] },
  { key: 'finance_head', name: 'Finance Head', description: 'Final authority: approvals, vendor controls, payment release, approval rules.',
    permissions: ['invoice.view_all', 'invoice.approve', 'invoice.reject', 'invoice.hold', 'invoice.comment',
      'vendor.view', 'vendor.approve', 'vendor.bank_change.approve', 'vendor.bank_reveal',
      'payment.view', 'payment.release_run', 'payment.hold', 'payment.release_hold', 'payment.confirm_paid',
      'bank.view', 'bank.configure', 'bank.approve_manual_match', 'rules.manage', 'tax.configure',
      'report.view_own', 'report.view_ops', 'report.view_all', 'audit.view'] },
  { key: 'admin', name: 'Admin', description: 'Manages users, roles and organisation settings. No financial permissions.',
    permissions: ['user.manage', 'role.manage', 'org.settings'] },
  { key: 'auditor', name: 'Auditor', description: 'Read-only access including the audit log.',
    permissions: ['invoice.view_all', 'vendor.view', 'payment.view', 'bank.view', 'report.view_all', 'audit.view', 'audit.export'] },
];

export function validatePermissionList(list: string[]): Permission[] {
  const bad = list.filter((p) => !isPermission(p));
  if (bad.length) throw new Error(`Unknown permission(s): ${bad.join(', ')}`);
  return Array.from(new Set(list)) as Permission[];
}
