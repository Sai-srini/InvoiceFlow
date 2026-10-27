/**
 * DEVELOPMENT ONLY demo data: one organisation with a user per role template, a vendor, tax settings and approval rules.
 * Needs SEED_PASSWORD (no default password exists anywhere). Refuses to run in production or on a non-empty database.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDB } from '../config/database';
import { Organisation, Role, User, ApprovalRule, Vendor } from '../models';
import { createOrganisation } from '../services/org.service';
import { hashPassword, validatePassword } from '../services/auth.service';
import { encryptSecret } from '../lib/crypto';
import { gstinCheckChar } from '../lib/validators';

async function main() {
  if (env.IS_PROD) throw new Error('Refusing to seed in production.');
  const pw = process.env.SEED_PASSWORD || ''; const bad = validatePassword(pw);
  if (bad) throw new Error(`Set SEED_PASSWORD to a strong password. ${bad}`);
  await connectDB();
  if (await Organisation.countDocuments({})) throw new Error('Database is not empty; refusing to seed.');
  const { org, roles } = await createOrganisation({ name: 'Demo Foods Pvt Ltd', adminEmail: 'admin@demo.test', adminName: 'Asha Admin', adminPassword: pw });
  const hash = await hashPassword(pw); const orgId = String(org._id);
  const mk = (email: string, name: string, key: string, extra: any = {}) => User.create({ organisation_id: orgId, email, full_name: name, role_id: roles[key]._id, password_hash: hash, is_active: true, ...extra });
  await mk('accounts@demo.test', 'Rohan Iyer', 'accounts_team'); await mk('requester@demo.test', 'Sam Dutta', 'requester');
  const a1 = await mk('approver@demo.test', 'Priya Nair', 'approver', { approval_limit_minor: 500000_00, departments: [] });
  await mk('approver2@demo.test', 'Vikram Shah', 'approver', { approval_limit_minor: 2000000_00 });
  await mk('head@demo.test', 'Anil Kapoor', 'finance_head', { approval_unlimited: true }); await mk('head2@demo.test', 'Meera Rao', 'finance_head', { approval_unlimited: true }); await mk('auditor@demo.test', 'Ila Menon', 'auditor');
  await Organisation.updateOne({ _id: orgId }, { $set: { 'settings.tax.tds_sections': [{ section: 'DEMO', description: 'Demo section — replace with your accountant\'s configuration', rate_bps: 100, threshold_minor: null }] } });
  await ApprovalRule.create([{ organisation_id: orgId, name: 'Under ₹4,00,000', min_minor: 0, max_minor: 400000_00, approvers_required: 1, mode: 'sequential', priority: 1 }, { organisation_id: orgId, name: '₹4,00,000 and above', min_minor: 400000_00, max_minor: null, approvers_required: 2, mode: 'sequential', priority: 1 }]);
  const g = '33AAAAA0000A1Z'; await Vendor.create({ organisation_id: orgId, name: 'Demo Packaging Works', gstin: g + gstinCheckChar(g), category: 'Packaging', tds_section: 'DEMO', status: 'active',
    bank: { account_name: 'Demo Packaging Works', account_number_enc: encryptSecret('123456789012'), account_last4: '9012', ifsc: 'HDFC0001234', bank_name: 'Demo Bank' } });
  void a1; console.log('Seeded demo org. Users: admin@ / accounts@ / requester@ / approver@ / approver2@ / head@ / head2@ / auditor@ demo.test with your SEED_PASSWORD.');
}
main().then(() => mongoose.disconnect()).catch(async (e) => { console.error('Seed failed:', e.message); await mongoose.disconnect(); process.exit(1); });
