import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'crypto';
import { env } from './config/env';
import { api } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { log } from './lib/logger';
import { registerAllJobs } from './workers';

export function createApp() {
  registerAllJobs();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.IS_PROD ? 1 : false);
  app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-Id', req.requestId); const t = Date.now();
    res.on('finish', () => { if (!req.path.endsWith('/health')) log('info', 'request', { request_id: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t }); }); next(); });
  app.use(helmet());
  const allowed = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  // Disallowed origins simply get no CORS headers (the browser then blocks cross-site reads); same-origin traffic is unaffected.
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (!env.IS_TEST) app.use('/api', apiLimiter());
  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
