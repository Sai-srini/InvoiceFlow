import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { env } from '../config/env';
import { log } from '../lib/logger';

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })), request_id: req.requestId });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details, request_id: req.requestId });
    return;
  }
  if (err?.code === 11000) {
    res.status(409).json({ error: 'A record with the same unique values already exists.', code: 'DUPLICATE', details: err.keyValue, request_id: req.requestId });
    return;
  }
  if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large.', code: 'TOO_LARGE' }); return; }
  if (err?.name === 'MulterError') { res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' }); return; }
  if (err?.name === 'ValidationError' || err?.name === 'CastError') { res.status(400).json({ error: err.message, code: 'VALIDATION' }); return; }
  log('error', 'unhandled_error', { request_id: req.requestId, method: req.method, path: req.path, message: err?.message, stack: env.IS_PROD ? undefined : err?.stack });
  res.status(500).json({ error: env.IS_PROD ? 'Internal server error' : String(err?.message || err), code: 'INTERNAL', request_id: req.requestId });
};
