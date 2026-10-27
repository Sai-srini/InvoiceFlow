import { env } from './config/env';
import { connectDB } from './config/database';
import { createApp } from './app';
import { startWorkers, closeQueues } from './queues';
import { log } from './lib/logger';
import mongoose from 'mongoose';

async function main() {
  await connectDB();
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
