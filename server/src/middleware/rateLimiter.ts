import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env } from '../config/env';
import { getRedis } from '../config/redis';

const store = () => {
  if (env.IS_TEST || env.QUEUES_INLINE) return undefined; // in-memory store
  const r = getRedis();
  return new RedisStore({ sendCommand: (...args: string[]) => (r as any).call(...args) });
};
export const apiLimiter = () => rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, store: store(), message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } });
export const authLimiter = () => rateLimit({ windowMs: 15 * 60_000, max: env.IS_TEST ? 1000 : 20, standardHeaders: true, legacyHeaders: false, store: store(), message: { error: 'Too many authentication attempts. Please try again later.', code: 'RATE_LIMITED' } });
