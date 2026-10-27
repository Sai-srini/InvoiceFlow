import IORedis from 'ioredis';
import { env } from './env';
import { log } from '../lib/logger';

let client: IORedis | null = null;
export const redisConnection = { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD, maxRetriesPerRequest: null as any };
/** Redis is created lazily so unit tests and inline-queue mode never need it. */
export function getRedis(): IORedis {
  if (!client) {
    client = new IORedis({ host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD, maxRetriesPerRequest: 3, lazyConnect: false });
    client.on('error', (e) => log('error', 'redis_error', { message: e.message }));
  }
  return client;
}
export const redisStatus = () => (client ? client.status : env.QUEUES_INLINE ? 'inline-mode' : 'not-started');
