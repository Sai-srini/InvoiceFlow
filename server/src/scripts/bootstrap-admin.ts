/**
 * First-run setup: creates an organisation, the six role templates and the first Admin user.
 *   ORG_NAME="Acme Pvt Ltd" ADMIN_EMAIL=admin@acme.com ADMIN_NAME="Asha Admin" ADMIN_PASSWORD='...' npm run bootstrap
 * Refuses to run if any organisation already exists (use the app to add users after that).
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/database';
import { Organisation } from '../models';
import { createOrganisation } from '../services/org.service';

async function main() {
  const { ORG_NAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
  if (!ORG_NAME || !ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) throw new Error('Set ORG_NAME, ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD.');
  await connectDB();
  if (await Organisation.countDocuments({})) throw new Error('An organisation already exists. Bootstrap only runs on an empty database.');
  const { org, admin } = await createOrganisation({ name: ORG_NAME, adminEmail: ADMIN_EMAIL, adminName: ADMIN_NAME, adminPassword: ADMIN_PASSWORD });
  console.log(`Created organisation "${org.name}" and admin ${admin.email}. Sign in, then: add Finance Head / Accounts users, tax (TDS) settings and approval rules.`);
}
main().then(() => mongoose.disconnect()).catch(async (e) => { console.error('Bootstrap failed:', e.message); await mongoose.disconnect(); process.exit(1); });
