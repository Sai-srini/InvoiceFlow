"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * First-run setup: creates an organisation, the six role templates and the first Admin user.
 *   ORG_NAME="Acme Pvt Ltd" ADMIN_EMAIL=admin@acme.com ADMIN_NAME="Asha Admin" ADMIN_PASSWORD='...' npm run bootstrap
 * Refuses to run if any organisation already exists (use the app to add users after that).
 */
const mongoose_1 = __importDefault(require("mongoose"));
const database_1 = require("../config/database");
const models_1 = require("../models");
const org_service_1 = require("../services/org.service");
async function main() {
    const { ORG_NAME, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
    if (!ORG_NAME || !ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD)
        throw new Error('Set ORG_NAME, ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD.');
    await (0, database_1.connectDB)();
    if (await models_1.Organisation.countDocuments({}))
        throw new Error('An organisation already exists. Bootstrap only runs on an empty database.');
    const { org, admin } = await (0, org_service_1.createOrganisation)({ name: ORG_NAME, adminEmail: ADMIN_EMAIL, adminName: ADMIN_NAME, adminPassword: ADMIN_PASSWORD });
    console.log(`Created organisation "${org.name}" and admin ${admin.email}. Sign in, then: add Finance Head / Accounts users, tax (TDS) settings and approval rules.`);
}
main().then(() => mongoose_1.default.disconnect()).catch(async (e) => { console.error('Bootstrap failed:', e.message); await mongoose_1.default.disconnect(); process.exit(1); });
//# sourceMappingURL=bootstrap-admin.js.map