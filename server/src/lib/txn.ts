import mongoose, { ClientSession } from 'mongoose';
import { env } from '../config/env';

/**
 * Runs fn inside a real MongoDB transaction (requires a replica set).
 * The session is retried automatically on transient errors by the driver.
 * TXN_DISABLED=1 (tests only, enforced in env.ts) runs fn without a session.
 */
export async function withTxn<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (env.TXN_DISABLED) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
