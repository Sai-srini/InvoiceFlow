import mongoose from 'mongoose';
import { env } from './env';
import { log } from '../lib/logger';

export async function connectDB() {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  log('info', 'mongo_connected');
  // Real transactions need a replica set; fail loudly at startup instead of at the first invoice.
  if (!env.TXN_DISABLED) {
    const hello: any = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
      throw new Error('MongoDB is not running as a replica set. Transactions are required. See README (docker compose runs rs0).');
    }
  }
}
