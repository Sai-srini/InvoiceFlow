"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedRoleTemplates = seedRoleTemplates;
exports.createOrganisation = createOrganisation;
exports.getOrg = getOrg;
exports.getSod = getSod;
const models_1 = require("../models");
const permissions_1 = require("../domain/permissions");
const policy_1 = require("../domain/policy");
const txn_1 = require("../lib/txn");
const audit_service_1 = require("./audit.service");
const auth_service_1 = require("./auth.service");
const errors_1 = require("../lib/errors");
async function seedRoleTemplates(orgId, session) {
    const out = {};
    for (const t of permissions_1.ROLE_TEMPLATES) {
        const [r] = await models_1.Role.create([{ organisation_id: orgId, key: t.key, name: t.name, description: t.description, permissions: t.permissions, is_template: true }], { session });
        out[t.key] = r;
    }
    return out;
}
/** First-run bootstrap: organisation, the six role templates and the first Admin user. */
async function createOrganisation(input) {
    const pw = (0, auth_service_1.validatePassword)(input.adminPassword);
    if (pw)
        throw (0, errors_1.badRequest)(pw);
    const hash = await (0, auth_service_1.hashPassword)(input.adminPassword);
    return (0, txn_1.withTxn)(async (session) => {
        const [org] = await models_1.Organisation.create([{ name: input.name, settings: { sod: (0, policy_1.mergeSod)() } }], { session });
        const roles = await seedRoleTemplates(String(org._id), session);
        const [admin] = await models_1.User.create([{ organisation_id: org._id, email: input.adminEmail, password_hash: hash, full_name: input.adminName,
                role_id: roles.admin._id, is_active: true, password_changed_at: new Date() }], { session });
        await (0, audit_service_1.writeAudit)({ orgId: String(org._id), userId: String(admin._id) }, { action: 'organisation.created', entity_type: 'Organisation', entity_id: org._id, new_values: { name: input.name } }, session);
        return { org, admin, roles };
    });
}
async function getOrg(orgId) {
    const o = await models_1.Organisation.findById(orgId).lean();
    if (!o)
        throw (0, errors_1.badRequest)('Organisation not found');
    return o;
}
async function getSod(orgId) { return (0, policy_1.mergeSod)((await getOrg(orgId)).settings?.sod); }
//# sourceMappingURL=org.service.js.map