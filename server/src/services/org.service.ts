import bcrypt from 'bcryptjs';
import { ClientSession } from 'mongoose';
import { Organisation, Role, User } from '../models';
import { ROLE_TEMPLATES } from '../domain/permissions';
import { mergeSod } from '../domain/policy';
import { withTxn } from '../lib/txn';
import { writeAudit } from './audit.service';
import { validatePassword, hashPassword } from './auth.service';
import { badRequest } from '../lib/errors';

export async function seedRoleTemplates(orgId: string, session?: ClientSession) {
  const out: Record<string, any> = {};
  for (const t of ROLE_TEMPLATES) {
    const [r] = await Role.create([{ organisation_id: orgId, key: t.key, name: t.name, description: t.description, permissions: t.permissions, is_template: true }], { session });
    out[t.key] = r;
  }
  return out;
}

/** First-run bootstrap: organisation, the six role templates and the first Admin user. */
export async function createOrganisation(input: { name: string; adminEmail: string; adminName: string; adminPassword: string }) {
  const pw = validatePassword(input.adminPassword); if (pw) throw badRequest(pw);
  const hash = await hashPassword(input.adminPassword);
  return withTxn(async (session) => {
    const [org]: any = await Organisation.create([{ name: input.name, settings: { sod: mergeSod() } }], { session });
    const roles = await seedRoleTemplates(String(org._id), session);
    const [admin]: any = await User.create([{ organisation_id: org._id, email: input.adminEmail, password_hash: hash, full_name: input.adminName,
      role_id: roles.admin._id, is_active: true, password_changed_at: new Date() }], { session });
    await writeAudit({ orgId: String(org._id), userId: String(admin._id) }, { action: 'organisation.created', entity_type: 'Organisation', entity_id: org._id, new_values: { name: input.name } }, session);
    return { org, admin, roles };
  });
}

export async function getOrg(orgId: string) {
  const o: any = await Organisation.findById(orgId).lean();
  if (!o) throw badRequest('Organisation not found');
  return o;
}
export async function getSod(orgId: string) { return mergeSod((await getOrg(orgId)).settings?.sod); }
