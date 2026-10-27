import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
export const validate = (schema: ZodSchema, where: 'body' | 'query' = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  try { (req as any)[where] = schema.parse((req as any)[where]); next(); } catch (e) { next(e); }
};
