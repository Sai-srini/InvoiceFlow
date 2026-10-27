import { env } from './config/env';
import { connectDB } from './config/database';
import { createApp } from './app';
import { startWorkers, closeQueues } from './queues';
import { log } from './lib/logger';
import { Organisation } from './models';
import { createOrganisation } from './services/org.service';
import mongoose from 'mongoose';

/** Cloud deploys boot cold: create the first organisation + Admin when boot credentials are provided. */
async function maybeBootstrap() {
  const { BOOTSTRAP_ORG_NAME: orgName, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
  if (!orgName || !email || !name || !password) return;
  if (await Organisation.countDocuments({})) return;
  const { org, admin } = await createOrganisation({ name: orgName, adminEmail: email, adminName: name, adminPassword: password });
  log('info', 'bootstrapped', { org: org.name, admin: admin.email });
}

async function main() {
  await connectDB();
  await maybeBootstrap();
  const app = createApp();
  const worker = await startWorkers();
  const server = app.listen(env.PORT, () => log('info', 'server_listening', { port: env.PORT, env: env.NODE_ENV }));
  const shutdown = async (sig: string) => {
    log('info', 'shutdown', { sig });
    server.close();
    try { await worker?.close(); await closeQueues(); await mongoose.disconnect(); } catch (e: any) { log('error', 'shutdown_error', { message: e.message }); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((e) => { log('error', 'fatal_startup', { message: e.message }); process.exit(1); });
