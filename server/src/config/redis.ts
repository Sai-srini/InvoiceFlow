import IORedis from 'ioredis';
import { env } from './env';
import { log } from '../lib/logger';

let client: IORedis | null = null;
/** Managed hosts (Upstash: TLS-only) come in as a DSN; Docker keeps using host/port. */
const dsn = env.REDIS_URL;
function sharedDsnClient(): IORedis {
  client = new IORedis(dsn, { maxRetriesPerRequest: 3, lazyConnect: false });
  client.on('error', (e) => log('error', 'redis_error', { message: e.message }));
  return client;
}
export const redisConnection: unknown = dsn ? sharedDsnClient() : { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD, maxRetriesPerRequest: null as any };
/** Redis is created lazily so unit tests and inline-queue mode never need it. */
export function getRedis(): IORedis {
  if (dsn) return client ?? sharedDsnClient();
  if (!client) {
    client = new IORedis({ host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD, maxRetriesPerRequest: 3, lazyConnect: false });
    client.on('error', (e) => log('error', 'redis_error', { message: e.message }));
  }
  return client;
}
export const redisStatus = () => (client ? client.status : env.QUEUES_INLINE ? 'inline-mode' : 'not-started');
