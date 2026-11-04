"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const app_1 = require("./app");
const queues_1 = require("./queues");
const logger_1 = require("./lib/logger");
const models_1 = require("./models");
const org_service_1 = require("./services/org.service");
const mongoose_1 = __importDefault(require("mongoose"));
/** Cloud deploys boot cold: create the first organisation + Admin when boot credentials are provided. */
async function maybeBootstrap() {
    const { BOOTSTRAP_ORG_NAME: orgName, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
    if (!orgName || !email || !name || !password)
        return;
    if (await models_1.Organisation.countDocuments({}))
        return;
    const { org, admin } = await (0, org_service_1.createOrganisation)({ name: orgName, adminEmail: email, adminName: name, adminPassword: password });
    (0, logger_1.log)('info', 'bootstrapped', { org: org.name, admin: admin.email });
}
async function main() {
    await (0, database_1.connectDB)();
    await maybeBootstrap();
    const app = (0, app_1.createApp)();
    const worker = await (0, queues_1.startWorkers)();
    const server = app.listen(env_1.env.PORT, () => (0, logger_1.log)('info', 'server_listening', { port: env_1.env.PORT, env: env_1.env.NODE_ENV }));
    const shutdown = async (sig) => {
        (0, logger_1.log)('info', 'shutdown', { sig });
        server.close();
        try {
            await worker?.close();
            await (0, queues_1.closeQueues)();
            await mongoose_1.default.disconnect();
        }
        catch (e) {
            (0, logger_1.log)('error', 'shutdown_error', { message: e.message });
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((e) => { (0, logger_1.log)('error', 'fatal_startup', { message: e.message }); process.exit(1); });
//# sourceMappingURL=index.js.map