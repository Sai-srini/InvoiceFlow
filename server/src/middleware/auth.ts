import { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../services/auth.service';
import { User, Role } from '../models';
import { forbidden, unauthorized } from '../lib/errors';
import { Permission } from '../domain/permissions';
import { Actor } from '../types';

/** Verifies the bearer token, then loads the user and CURRENT permissions from the database on every request. */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) throw unauthorized('Authentication required.');
    let claims;
    try { claims = verifyAccess(h.slice(7)); } catch { throw unauthorized('Invalid or expired token.'); }
    const user: any = await User.findOne({ _id: claims.sub, organisation_id: claims.org });
    if (!user || !user.is_active || user.token_version !== claims.tv) throw unauthorized('Session is no longer valid.');
    const role: any = await Role.findOne({ _id: user.role_id, organisation_id: claims.org }).lean();
    req.actor = {
      orgId: claims.org, userId: String(user._id), email: user.email, name: user.full_name, user,
      permissions: new Set<Permission>((role?.permissions || []) as Permission[]),
      ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200),
    } as Actor;
    next();
  } catch (e) { next(e); }
};

/** Allows the request when the user holds ALL of the listed permissions. */
export const requirePermission = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.actor) return next(unauthorized());
  const missing = perms.filter((p) => !req.actor!.permissions.has(p));
  if (missing.length) return next(forbidden(`Missing permission: ${missing.join(', ')}`, 'MISSING_PERMISSION', { required: perms }));
  next();
};
/** Allows the request when the user holds AT LEAST ONE of the listed permissions. */
export const requireAnyPermission = (...perms: Permission[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.actor) return next(unauthorized());
  if (!perms.some((p) => req.actor!.permissions.has(p))) return next(forbidden(`Requires one of: ${perms.join(', ')}`, 'MISSING_PERMISSION', { required_any: perms }));
  next();
};
export const can = (a: Actor, p: Permission) => a.permissions.has(p);
