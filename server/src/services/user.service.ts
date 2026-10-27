import { Request } from 'express';
import mongoose from 'mongoose';
import { User, Role, Delegation, Organisation } from '../models';
import { Actor } from '../types';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { validatePermissionList } from '../domain/permissions';
import { createInvitationToken, deliverInvitation, revokeAllSessions } from './auth.service';
import { paginate } from '../lib/paginate';
import { mergeSod } from '../domain/policy';

const dto = (u: any, roles: Map<string, any>) => ({
  id: String(u._id), email: u.email, full_name: u.full_name, department: u.department, departments: u.departments, cost_centres: u.cost_centres,
  role: roles.get(String(u.role_id)) ? { id: String(u.role_id), name: roles.get(String(u.role_id)).name } : null,
  approval_limit_minor: u.approval_unlimited ? null : u.approval_limit_minor, approval_unlimited: !!u.approval_unlimited,
  is_active: u.is_active, pending_invitation: !u.password_hash, locked: !!(u.locked_until && u.locked_until > new Date()), last_login_at: u.last_login_at,
});
const roleMap = async (orgId: string) => new Map<string, any>((await Role.find({ organisation_id: orgId }).lean()).map((r: any) => [String(r._id), r]));

/** Guard: the organisation must always keep at least one active user who can manage users. */
async function assertAdminRemains(orgId: string, changing: { userId?: string; roleId?: string }, after: { active: boolean; roleId?: string }) {
  const adminRoles = (await Role.find({ organisation_id: orgId, permissions: 'user.manage' }).lean()).map((r: any) => String(r._id));
  const users = await User.find({ organisation_id: orgId, is_active: true, role_id: { $in: adminRoles } }).lean();
  const remaining = users.filter((u: any) => String(u._id) !== changing.userId);
  const stays = changing.userId && after.active && after.roleId && adminRoles.includes(String(after.roleId));
  if (remaining.length === 0 && !stays) throw conflict('This would leave the organisation without an active user who can manage users.', 'LAST_ADMIN');
}

export async function listUsers(actor: Actor, req: Request) {
  const roles = await roleMap(actor.orgId);
  const filter: any = { organisation_id: actor.orgId };
  if (req.query.active === 'true') filter.is_active = true;
  const page = await paginate(User.find(filter).sort({ full_name: 1 }), User.countDocuments(filter), req);
  return { ...page, data: page.data.map((u: any) => dto(u, roles)) };
}

export async function inviteUser(actor: Actor, input: any) {
  const role: any = await Role.findOne({ _id: input.role_id, organisation_id: actor.orgId }).lean();
  if (!role) throw badRequest('Role not found.');
  const exists = await User.findOne({ email: input.email.toLowerCase() }).setOptions({ skipTenant: true }).lean();
  if (exists) throw conflict('A user with this email already exists.', 'EMAIL_EXISTS');
  const { user, raw } = await withTxn(async (session) => {
    const [u]: any = await User.create([{ organisation_id: actor.orgId, email: input.email, full_name: input.full_name, role_id: input.role_id, department: input.department || null,
      departments: input.departments || [], cost_centres: input.cost_centres || [], approval_limit_minor: input.approval_limit_minor ?? 0, approval_unlimited: !!input.approval_unlimited, is_active: false }], { session });
    const raw = await createInvitationToken(actor, String(u._id), 'invite', session);
    await writeAudit(actor, { action: 'user.invited', entity_type: 'User', entity_id: u._id, new_values: { email: u.email, role: role.name } }, session);
    return { user: u, raw };
  });
  const delivery = await deliverInvitation(user.email, 'invite', raw);
  return { user: dto(user, await roleMap(actor.orgId)), ...delivery };
}

export async function updateUser(actor: Actor, id: string, patch: any) {
  const u: any = await User.findOne({ _id: id, organisation_id: actor.orgId });
  if (!u) throw notFound('User');
  if (patch.role_id) { const r = await Role.findOne({ _id: patch.role_id, organisation_id: actor.orgId }).lean(); if (!r) throw badRequest('Role not found.'); }
  const nextActive = patch.is_active ?? u.is_active; const nextRole = patch.role_id ?? String(u.role_id);
  if (patch.is_active === false || patch.role_id) await assertAdminRemains(actor.orgId, { userId: id }, { active: nextActive, roleId: nextRole });
  const before = { role_id: String(u.role_id), is_active: u.is_active, limit: u.approval_limit_minor, unlimited: u.approval_unlimited, departments: u.departments, cost_centres: u.cost_centres, full_name: u.full_name, department: u.department };
  await withTxn(async (session) => {
    Object.assign(u, Object.fromEntries(Object.entries({ role_id: patch.role_id, is_active: patch.is_active, approval_limit_minor: patch.approval_limit_minor, approval_unlimited: patch.approval_unlimited,
      departments: patch.departments, cost_centres: patch.cost_centres, full_name: patch.full_name, department: patch.department }).filter(([, v]) => v !== undefined)));
    await u.save({ session });
    await writeAudit(actor, { action: 'user.updated', entity_type: 'User', entity_id: id, old_values: before, new_values: patch }, session);
  });
  if (patch.role_id || patch.is_active === false) await revokeAllSessions(actor.orgId, id);
  return dto(u, await roleMap(actor.orgId));
}

export async function startReset(actor: Actor, id: string) {
  const u: any = await User.findOne({ _id: id, organisation_id: actor.orgId });
  if (!u) throw notFound('User');
  const raw = await withTxn(async (s) => { const r = await createInvitationToken(actor, id, 'reset', s); await writeAudit(actor, { action: 'user.reset_started', entity_type: 'User', entity_id: id }, s); return r; });
  return deliverInvitation(u.email, 'reset', raw);
}
export async function forceLogout(actor: Actor, id: string) {
  const u = await User.findOne({ _id: id, organisation_id: actor.orgId }).lean(); if (!u) throw notFound('User');
  await revokeAllSessions(actor.orgId, id);
  await withTxn((s) => writeAudit(actor, { action: 'user.forced_logout', entity_type: 'User', entity_id: id }, s));
}

// ---------------- roles
export async function listRoles(actor: Actor) {
  const roles: any[] = await Role.find({ organisation_id: actor.orgId }).sort({ name: 1 }).lean();
  const counts: any[] = await User.aggregate([{ $match: { organisation_id: new mongoose.Types.ObjectId(actor.orgId) } }, { $group: { _id: '$role_id', n: { $sum: 1 } } }]);
  const c = new Map(counts.map((x) => [String(x._id), x.n]));
  return roles.map((r) => ({ id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: r.is_template, user_count: c.get(String(r._id)) || 0 }));
}
export async function createRole(actor: Actor, input: { name: string; description?: string; permissions: string[] }) {
  const permissions = (() => { try { return validatePermissionList(input.permissions); } catch (e: any) { throw badRequest(e.message); } })();
  return withTxn(async (session) => {
    const [r]: any = await Role.create([{ organisation_id: actor.orgId, name: input.name, description: input.description || '', permissions }], { session });
    await writeAudit(actor, { action: 'role.created', entity_type: 'Role', entity_id: r._id, new_values: { name: r.name, permissions } }, session);
    return { id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: false };
  });
}
export async function updateRole(actor: Actor, id: string, input: { name?: string; description?: string; permissions?: string[] }) {
  const r: any = await Role.findOne({ _id: id, organisation_id: actor.orgId });
  if (!r) throw notFound('Role');
  const permissions = input.permissions ? (() => { try { return validatePermissionList(input.permissions!); } catch (e: any) { throw badRequest(e.message); } })() : r.permissions;
  const before = { name: r.name, permissions: [...r.permissions] };
  if (!permissions.includes('user.manage') && r.permissions.includes('user.manage')) {
    const others = (await Role.find({ organisation_id: actor.orgId, permissions: 'user.manage', _id: { $ne: r._id } }).lean()).map((x: any) => String(x._id));
    const n = await User.countDocuments({ organisation_id: actor.orgId, is_active: true, role_id: { $in: others } });
    if (n === 0) throw conflict('Removing user.manage from this role would leave nobody able to manage users.', 'LAST_ADMIN');
  }
  await withTxn(async (session) => {
    if (input.name) r.name = input.name; if (input.description !== undefined) r.description = input.description; r.permissions = permissions;
    await r.save({ session });
    await writeAudit(actor, { action: 'role.updated', entity_type: 'Role', entity_id: id, old_values: before, new_values: { name: r.name, permissions } }, session);
  });
  // Permissions are read from the database on every request, so the change applies immediately.
  return { id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: r.is_template };
}
export async function deleteRole(actor: Actor, id: string) {
  if (await User.countDocuments({ organisation_id: actor.orgId, role_id: id })) throw conflict('This role is still assigned to users.', 'ROLE_IN_USE');
  const r: any = await Role.findOne({ _id: id, organisation_id: actor.orgId }); if (!r) throw notFound('Role');
  await withTxn(async (s) => { await Role.deleteOne({ _id: id, organisation_id: actor.orgId }, { session: s }); await writeAudit(actor, { action: 'role.deleted', entity_type: 'Role', entity_id: id, old_values: { name: r.name } }, s); });
}

// ---------------- delegation
export async function createDelegation(actor: Actor, input: { from_user?: string; to_user: string; starts_at: Date; ends_at: Date; reason?: string }) {
  const from = input.from_user && actor.permissions.has('user.manage') ? input.from_user : actor.userId;
  if (input.from_user && input.from_user !== actor.userId && !actor.permissions.has('user.manage')) throw forbidden('You can only delegate your own approvals.');
  if (String(from) === String(input.to_user)) throw badRequest('You cannot delegate to yourself.');
  if (input.ends_at <= input.starts_at) throw badRequest('End must be after start.');
  const to: any = await User.findOne({ _id: input.to_user, organisation_id: actor.orgId, is_active: true }).lean();
  const role: any = to && (await Role.findOne({ _id: to.role_id, organisation_id: actor.orgId }).lean());
  if (!to || !role?.permissions.includes('invoice.approve')) throw badRequest('The delegate must be an active user who can approve invoices.');
  return withTxn(async (session) => {
    const [d]: any = await Delegation.create([{ organisation_id: actor.orgId, from_user: from, to_user: input.to_user, starts_at: input.starts_at, ends_at: input.ends_at, created_by: actor.userId, reason: input.reason || '' }], { session });
    await writeAudit(actor, { action: 'delegation.created', entity_type: 'Delegation', entity_id: d._id, new_values: { from, to: input.to_user, starts_at: input.starts_at, ends_at: input.ends_at } }, session);
    return d.toObject();
  });
}
export async function listDelegations(actor: Actor) {
  const f: any = { organisation_id: actor.orgId, revoked_at: null, ends_at: { $gte: new Date() } };
  if (!actor.permissions.has('user.manage')) f.$or = [{ from_user: actor.userId }, { to_user: actor.userId }];
  return Delegation.find(f).sort({ starts_at: 1 }).lean();
}
export async function revokeDelegation(actor: Actor, id: string) {
  const d: any = await Delegation.findOne({ _id: id, organisation_id: actor.orgId });
  if (!d) throw notFound('Delegation');
  if (String(d.from_user) !== actor.userId && !actor.permissions.has('user.manage')) throw forbidden();
  await withTxn(async (s) => { d.revoked_at = new Date(); await d.save({ session: s }); await writeAudit(actor, { action: 'delegation.revoked', entity_type: 'Delegation', entity_id: id }, s); });
}

// ---------------- organisation settings
const SettingsPatch = {
  sod: (cur: any, patch: any) => ({ ...mergeSod(cur), ...patch }),
};
export async function updateSettings(actor: Actor, section: 'sod' | 'tax' | 'recon', patch: any) {
  const org: any = await Organisation.findById(actor.orgId);
  const before = JSON.parse(JSON.stringify(org.settings?.[section] ?? null));
  await withTxn(async (session) => {
    if (section === 'sod') org.settings.sod = SettingsPatch.sod(before, patch);
    else if (section === 'tax') { org.settings.tax = { gstin: patch.gstin ?? null, state_code: patch.state_code ?? null, tds_sections: patch.tds_sections || [] }; }
    else org.settings.recon = { tolerance_minor: patch.tolerance_minor ?? 0, date_window_days: patch.date_window_days ?? 5, classifiers: patch.classifiers || [] };
    org.markModified('settings');
    await org.save({ session });
    await writeAudit(actor, { action: `settings.${section}_updated`, entity_type: 'Organisation', entity_id: actor.orgId, old_values: before, new_values: org.settings[section] }, session);
  });
  return org.toObject().settings;
}
export async function getSettings(actor: Actor) {
  const org: any = await Organisation.findById(actor.orgId).lean();
  return { name: org.name, currency: org.currency, sod: mergeSod(org.settings?.sod), tax: org.settings?.tax || { gstin: null, state_code: null, tds_sections: [] }, recon: org.settings?.recon || { tolerance_minor: 0, date_window_days: 5, classifiers: [] } };
}

/** Names of active users who can approve invoices: for delegation and approval-rule pickers. No emails or limits are exposed. */
export async function listApprovers(actor: Actor) {
  const roles: any[] = await Role.find({ organisation_id: actor.orgId, permissions: 'invoice.approve' }).lean();
  const names = new Map(roles.map((r) => [String(r._id), r.name]));
  const users: any[] = await User.find({ organisation_id: actor.orgId, is_active: true, role_id: { $in: roles.map((r) => r._id) } }).sort({ full_name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), full_name: u.full_name, role: names.get(String(u.role_id)) }));
}
