"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = listUsers;
exports.inviteUser = inviteUser;
exports.updateUser = updateUser;
exports.startReset = startReset;
exports.forceLogout = forceLogout;
exports.listRoles = listRoles;
exports.createRole = createRole;
exports.updateRole = updateRole;
exports.deleteRole = deleteRole;
exports.createDelegation = createDelegation;
exports.listDelegations = listDelegations;
exports.revokeDelegation = revokeDelegation;
exports.updateSettings = updateSettings;
exports.getSettings = getSettings;
exports.listApprovers = listApprovers;
const mongoose_1 = __importDefault(require("mongoose"));
const models_1 = require("../models");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const errors_1 = require("../lib/errors");
const permissions_1 = require("../domain/permissions");
const auth_service_1 = require("./auth.service");
const paginate_1 = require("../lib/paginate");
const policy_1 = require("../domain/policy");
const dto = (u, roles) => ({
    id: String(u._id), email: u.email, full_name: u.full_name, department: u.department, departments: u.departments, cost_centres: u.cost_centres,
    role: roles.get(String(u.role_id)) ? { id: String(u.role_id), name: roles.get(String(u.role_id)).name } : null,
    approval_limit_minor: u.approval_unlimited ? null : u.approval_limit_minor, approval_unlimited: !!u.approval_unlimited,
    is_active: u.is_active, pending_invitation: !u.password_hash, locked: !!(u.locked_until && u.locked_until > new Date()), last_login_at: u.last_login_at,
});
const roleMap = async (orgId) => new Map((await models_1.Role.find({ organisation_id: orgId }).lean()).map((r) => [String(r._id), r]));
/** Guard: the organisation must always keep at least one active user who can manage users. */
async function assertAdminRemains(orgId, changing, after) {
    const adminRoles = (await models_1.Role.find({ organisation_id: orgId, permissions: 'user.manage' }).lean()).map((r) => String(r._id));
    const users = await models_1.User.find({ organisation_id: orgId, is_active: true, role_id: { $in: adminRoles } }).lean();
    const remaining = users.filter((u) => String(u._id) !== changing.userId);
    const stays = changing.userId && after.active && after.roleId && adminRoles.includes(String(after.roleId));
    if (remaining.length === 0 && !stays)
        throw (0, errors_1.conflict)('This would leave the organisation without an active user who can manage users.', 'LAST_ADMIN');
}
async function listUsers(actor, req) {
    const roles = await roleMap(actor.orgId);
    const filter = { organisation_id: actor.orgId };
    if (req.query.active === 'true')
        filter.is_active = true;
    const page = await (0, paginate_1.paginate)(models_1.User.find(filter).sort({ full_name: 1 }), models_1.User.countDocuments(filter), req);
    return { ...page, data: page.data.map((u) => dto(u, roles)) };
}
async function inviteUser(actor, input) {
    const role = await models_1.Role.findOne({ _id: input.role_id, organisation_id: actor.orgId }).lean();
    if (!role)
        throw (0, errors_1.badRequest)('Role not found.');
    const exists = await models_1.User.findOne({ email: input.email.toLowerCase() }).setOptions({ skipTenant: true }).lean();
    if (exists)
        throw (0, errors_1.conflict)('A user with this email already exists.', 'EMAIL_EXISTS');
    const { user, raw } = await (0, txn_1.withTxn)(async (session) => {
        const [u] = await models_1.User.create([{ organisation_id: actor.orgId, email: input.email, full_name: input.full_name, role_id: input.role_id, department: input.department || null,
                departments: input.departments || [], cost_centres: input.cost_centres || [], approval_limit_minor: input.approval_limit_minor ?? 0, approval_unlimited: !!input.approval_unlimited, is_active: false }], { session });
        const raw = await (0, auth_service_1.createInvitationToken)(actor, String(u._id), 'invite', session);
        await (0, audit_service_1.writeAudit)(actor, { action: 'user.invited', entity_type: 'User', entity_id: u._id, new_values: { email: u.email, role: role.name } }, session);
        return { user: u, raw };
    });
    const delivery = await (0, auth_service_1.deliverInvitation)(user.email, 'invite', raw);
    return { user: dto(user, await roleMap(actor.orgId)), ...delivery };
}
async function updateUser(actor, id, patch) {
    const u = await models_1.User.findOne({ _id: id, organisation_id: actor.orgId });
    if (!u)
        throw (0, errors_1.notFound)('User');
    if (patch.role_id) {
        const r = await models_1.Role.findOne({ _id: patch.role_id, organisation_id: actor.orgId }).lean();
        if (!r)
            throw (0, errors_1.badRequest)('Role not found.');
    }
    const nextActive = patch.is_active ?? u.is_active;
    const nextRole = patch.role_id ?? String(u.role_id);
    if (patch.is_active === false || patch.role_id)
        await assertAdminRemains(actor.orgId, { userId: id }, { active: nextActive, roleId: nextRole });
    const before = { role_id: String(u.role_id), is_active: u.is_active, limit: u.approval_limit_minor, unlimited: u.approval_unlimited, departments: u.departments, cost_centres: u.cost_centres, full_name: u.full_name, department: u.department };
    await (0, txn_1.withTxn)(async (session) => {
        Object.assign(u, Object.fromEntries(Object.entries({ role_id: patch.role_id, is_active: patch.is_active, approval_limit_minor: patch.approval_limit_minor, approval_unlimited: patch.approval_unlimited,
            departments: patch.departments, cost_centres: patch.cost_centres, full_name: patch.full_name, department: patch.department }).filter(([, v]) => v !== undefined)));
        await u.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'user.updated', entity_type: 'User', entity_id: id, old_values: before, new_values: patch }, session);
    });
    if (patch.role_id || patch.is_active === false)
        await (0, auth_service_1.revokeAllSessions)(actor.orgId, id);
    return dto(u, await roleMap(actor.orgId));
}
async function startReset(actor, id) {
    const u = await models_1.User.findOne({ _id: id, organisation_id: actor.orgId });
    if (!u)
        throw (0, errors_1.notFound)('User');
    const raw = await (0, txn_1.withTxn)(async (s) => { const r = await (0, auth_service_1.createInvitationToken)(actor, id, 'reset', s); await (0, audit_service_1.writeAudit)(actor, { action: 'user.reset_started', entity_type: 'User', entity_id: id }, s); return r; });
    return (0, auth_service_1.deliverInvitation)(u.email, 'reset', raw);
}
async function forceLogout(actor, id) {
    const u = await models_1.User.findOne({ _id: id, organisation_id: actor.orgId }).lean();
    if (!u)
        throw (0, errors_1.notFound)('User');
    await (0, auth_service_1.revokeAllSessions)(actor.orgId, id);
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'user.forced_logout', entity_type: 'User', entity_id: id }, s));
}
// ---------------- roles
async function listRoles(actor) {
    const roles = await models_1.Role.find({ organisation_id: actor.orgId }).sort({ name: 1 }).lean();
    const counts = await models_1.User.aggregate([{ $match: { organisation_id: new mongoose_1.default.Types.ObjectId(actor.orgId) } }, { $group: { _id: '$role_id', n: { $sum: 1 } } }]);
    const c = new Map(counts.map((x) => [String(x._id), x.n]));
    return roles.map((r) => ({ id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: r.is_template, user_count: c.get(String(r._id)) || 0 }));
}
async function createRole(actor, input) {
    const permissions = (() => { try {
        return (0, permissions_1.validatePermissionList)(input.permissions);
    }
    catch (e) {
        throw (0, errors_1.badRequest)(e.message);
    } })();
    return (0, txn_1.withTxn)(async (session) => {
        const [r] = await models_1.Role.create([{ organisation_id: actor.orgId, name: input.name, description: input.description || '', permissions }], { session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'role.created', entity_type: 'Role', entity_id: r._id, new_values: { name: r.name, permissions } }, session);
        return { id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: false };
    });
}
async function updateRole(actor, id, input) {
    const r = await models_1.Role.findOne({ _id: id, organisation_id: actor.orgId });
    if (!r)
        throw (0, errors_1.notFound)('Role');
    const permissions = input.permissions ? (() => { try {
        return (0, permissions_1.validatePermissionList)(input.permissions);
    }
    catch (e) {
        throw (0, errors_1.badRequest)(e.message);
    } })() : r.permissions;
    const before = { name: r.name, permissions: [...r.permissions] };
    if (!permissions.includes('user.manage') && r.permissions.includes('user.manage')) {
        const others = (await models_1.Role.find({ organisation_id: actor.orgId, permissions: 'user.manage', _id: { $ne: r._id } }).lean()).map((x) => String(x._id));
        const n = await models_1.User.countDocuments({ organisation_id: actor.orgId, is_active: true, role_id: { $in: others } });
        if (n === 0)
            throw (0, errors_1.conflict)('Removing user.manage from this role would leave nobody able to manage users.', 'LAST_ADMIN');
    }
    await (0, txn_1.withTxn)(async (session) => {
        if (input.name)
            r.name = input.name;
        if (input.description !== undefined)
            r.description = input.description;
        r.permissions = permissions;
        await r.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'role.updated', entity_type: 'Role', entity_id: id, old_values: before, new_values: { name: r.name, permissions } }, session);
    });
    // Permissions are read from the database on every request, so the change applies immediately.
    return { id: String(r._id), name: r.name, description: r.description, permissions: r.permissions, is_template: r.is_template };
}
async function deleteRole(actor, id) {
    if (await models_1.User.countDocuments({ organisation_id: actor.orgId, role_id: id }))
        throw (0, errors_1.conflict)('This role is still assigned to users.', 'ROLE_IN_USE');
    const r = await models_1.Role.findOne({ _id: id, organisation_id: actor.orgId });
    if (!r)
        throw (0, errors_1.notFound)('Role');
    await (0, txn_1.withTxn)(async (s) => { await models_1.Role.deleteOne({ _id: id, organisation_id: actor.orgId }, { session: s }); await (0, audit_service_1.writeAudit)(actor, { action: 'role.deleted', entity_type: 'Role', entity_id: id, old_values: { name: r.name } }, s); });
}
// ---------------- delegation
async function createDelegation(actor, input) {
    const from = input.from_user && actor.permissions.has('user.manage') ? input.from_user : actor.userId;
    if (input.from_user && input.from_user !== actor.userId && !actor.permissions.has('user.manage'))
        throw (0, errors_1.forbidden)('You can only delegate your own approvals.');
    if (String(from) === String(input.to_user))
        throw (0, errors_1.badRequest)('You cannot delegate to yourself.');
    if (input.ends_at <= input.starts_at)
        throw (0, errors_1.badRequest)('End must be after start.');
    const to = await models_1.User.findOne({ _id: input.to_user, organisation_id: actor.orgId, is_active: true }).lean();
    const role = to && (await models_1.Role.findOne({ _id: to.role_id, organisation_id: actor.orgId }).lean());
    if (!to || !role?.permissions.includes('invoice.approve'))
        throw (0, errors_1.badRequest)('The delegate must be an active user who can approve invoices.');
    return (0, txn_1.withTxn)(async (session) => {
        const [d] = await models_1.Delegation.create([{ organisation_id: actor.orgId, from_user: from, to_user: input.to_user, starts_at: input.starts_at, ends_at: input.ends_at, created_by: actor.userId, reason: input.reason || '' }], { session });
        await (0, audit_service_1.writeAudit)(actor, { action: 'delegation.created', entity_type: 'Delegation', entity_id: d._id, new_values: { from, to: input.to_user, starts_at: input.starts_at, ends_at: input.ends_at } }, session);
        return d.toObject();
    });
}
async function listDelegations(actor) {
    const f = { organisation_id: actor.orgId, revoked_at: null, ends_at: { $gte: new Date() } };
    if (!actor.permissions.has('user.manage'))
        f.$or = [{ from_user: actor.userId }, { to_user: actor.userId }];
    return models_1.Delegation.find(f).sort({ starts_at: 1 }).lean();
}
async function revokeDelegation(actor, id) {
    const d = await models_1.Delegation.findOne({ _id: id, organisation_id: actor.orgId });
    if (!d)
        throw (0, errors_1.notFound)('Delegation');
    if (String(d.from_user) !== actor.userId && !actor.permissions.has('user.manage'))
        throw (0, errors_1.forbidden)();
    await (0, txn_1.withTxn)(async (s) => { d.revoked_at = new Date(); await d.save({ session: s }); await (0, audit_service_1.writeAudit)(actor, { action: 'delegation.revoked', entity_type: 'Delegation', entity_id: id }, s); });
}
// ---------------- organisation settings
const SettingsPatch = {
    sod: (cur, patch) => ({ ...(0, policy_1.mergeSod)(cur), ...patch }),
};
async function updateSettings(actor, section, patch) {
    const org = await models_1.Organisation.findById(actor.orgId);
    const before = JSON.parse(JSON.stringify(org.settings?.[section] ?? null));
    await (0, txn_1.withTxn)(async (session) => {
        if (section === 'sod')
            org.settings.sod = SettingsPatch.sod(before, patch);
        else if (section === 'tax') {
            org.settings.tax = { gstin: patch.gstin ?? null, state_code: patch.state_code ?? null, tds_sections: patch.tds_sections || [] };
        }
        else
            org.settings.recon = { tolerance_minor: patch.tolerance_minor ?? 0, date_window_days: patch.date_window_days ?? 5, classifiers: patch.classifiers || [] };
        org.markModified('settings');
        await org.save({ session });
        await (0, audit_service_1.writeAudit)(actor, { action: `settings.${section}_updated`, entity_type: 'Organisation', entity_id: actor.orgId, old_values: before, new_values: org.settings[section] }, session);
    });
    return org.toObject().settings;
}
async function getSettings(actor) {
    const org = await models_1.Organisation.findById(actor.orgId).lean();
    return { name: org.name, currency: org.currency, sod: (0, policy_1.mergeSod)(org.settings?.sod), tax: org.settings?.tax || { gstin: null, state_code: null, tds_sections: [] }, recon: org.settings?.recon || { tolerance_minor: 0, date_window_days: 5, classifiers: [] } };
}
/** Names of active users who can approve invoices: for delegation and approval-rule pickers. No emails or limits are exposed. */
async function listApprovers(actor) {
    const roles = await models_1.Role.find({ organisation_id: actor.orgId, permissions: 'invoice.approve' }).lean();
    const names = new Map(roles.map((r) => [String(r._id), r.name]));
    const users = await models_1.User.find({ organisation_id: actor.orgId, is_active: true, role_id: { $in: roles.map((r) => r._id) } }).sort({ full_name: 1 }).lean();
    return users.map((u) => ({ id: String(u._id), full_name: u.full_name, role: names.get(String(u.role_id)) }));
}
//# sourceMappingURL=user.service.js.map