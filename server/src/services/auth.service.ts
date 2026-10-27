import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { User, Role, RefreshToken, Invitation } from '../models';
import { randomToken, sha256 } from '../lib/crypto';
import { AppError, badRequest, unauthorized } from '../lib/errors';
import { writeAudit, AuditActor } from './audit.service';
import { withTxn } from '../lib/txn';
import { sendMailDirect } from './notification.service';
import { Permission } from '../domain/permissions';

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || (env.IS_TEST ? '4' : '12'), 10);
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return 'Password needs upper and lower case letters, a number and a symbol.';
  return null;
}

export interface Session { accessToken: string; refreshToken: string; expiresIn: number; user: any; }

function signAccess(user: any): string {
  return jwt.sign({ sub: String(user._id), org: String(user.organisation_id), tv: user.token_version }, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256' });
}
export function verifyAccess(token: string): { sub: string; org: string; tv: number } {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as any;
}

async function issueSession(user: any, family: string | null, ip?: string): Promise<Session> {
  const raw = randomToken(48);
  const fam = family || randomToken(12);
  await RefreshToken.create({ organisation_id: user.organisation_id, user_id: user._id, family: fam, token_hash: sha256(raw),
    expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000), ip });
  return { accessToken: signAccess(user), refreshToken: raw, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user };
}

export async function publicUser(user: any) {
  const role: any = await Role.findOne({ _id: user.role_id, organisation_id: user.organisation_id }).lean();
  return {
    id: String(user._id), email: user.email, full_name: user.full_name, department: user.department,
    role: role ? { id: String(role._id), name: role.name } : null, permissions: (role?.permissions || []) as Permission[],
    approval_limit_minor: user.approval_unlimited ? null : user.approval_limit_minor, approval_unlimited: !!user.approval_unlimited,
    mfa_enabled: !!user.mfa_enabled,
  };
}

const bad = () => unauthorized('Invalid email or password.');

export async function login(email: string, password: string, ip?: string, ua?: string): Promise<Session> {
  const user: any = await User.findOne({ email: String(email || '').toLowerCase().trim() }).setOptions({ skipTenant: true });
  const actor: AuditActor | null = user ? { orgId: String(user.organisation_id), userId: String(user._id), ip, ua } : null;
  if (!user || !user.password_hash || !user.is_active) { await bcrypt.compare(String(password || ''), DUMMY_HASH); throw bad(); }
  if (user.locked_until && user.locked_until > new Date()) throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or ask an admin to reset your password.');
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) {
    const n = (user.failed_login_count || 0) + 1;
    const lock = n >= env.LOGIN_MAX_FAILURES;
    await User.updateOne({ _id: user._id, organisation_id: user.organisation_id }, { $set: { failed_login_count: lock ? 0 : n, locked_until: lock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60000) : null } });
    await withTxn((s) => writeAudit(actor!, { action: lock ? 'auth.account_locked' : 'auth.login_failed', entity_type: 'User', entity_id: user._id }, s));
    throw bad();
  }
  await User.updateOne({ _id: user._id, organisation_id: user.organisation_id }, { $set: { failed_login_count: 0, locked_until: null, last_login_at: new Date() } });
  await withTxn((s) => writeAudit(actor!, { action: 'auth.login', entity_type: 'User', entity_id: user._id }, s));
  return issueSession(user, null, ip);
}

export async function refresh(raw: string, ip?: string): Promise<Session> {
  if (!raw) throw unauthorized('No session.');
  const tok: any = await RefreshToken.findOne({ token_hash: sha256(raw) }).setOptions({ skipTenant: true });
  if (!tok) throw unauthorized('Session expired. Please sign in again.');
  if (tok.revoked_at) {
    // A rotated token was presented again: treat the family as stolen and revoke all of it.
    await RefreshToken.updateMany({ family: tok.family, organisation_id: tok.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    throw unauthorized('Session expired. Please sign in again.');
  }
  if (tok.expires_at < new Date()) throw unauthorized('Session expired. Please sign in again.');
  const user: any = await User.findOne({ _id: tok.user_id, organisation_id: tok.organisation_id });
  if (!user || !user.is_active) throw unauthorized('Account is not active.');
  tok.revoked_at = new Date(); await tok.save();
  return issueSession(user, tok.family, ip);
}

export async function logout(raw: string) {
  if (!raw) return;
  const tok: any = await RefreshToken.findOne({ token_hash: sha256(raw) }).setOptions({ skipTenant: true });
  if (tok) await RefreshToken.updateMany({ family: tok.family, organisation_id: tok.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
}

/** Ends every session of a user immediately (access tokens die through token_version). */
export async function revokeAllSessions(orgId: string, userId: string) {
  await User.updateOne({ _id: userId, organisation_id: orgId }, { $inc: { token_version: 1 } });
  await RefreshToken.updateMany({ user_id: userId, organisation_id: orgId, revoked_at: null }, { $set: { revoked_at: new Date() } });
}

/** Google sign-in: the ID token is verified server-side. It can only sign in EXISTING active users; it never creates one. */
export async function googleLogin(idToken: string, ip?: string, ua?: string): Promise<Session> {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError(404, 'NOT_CONFIGURED', 'Google sign-in is not enabled.');
  if (!idToken) throw badRequest('Missing Google credential.');
  let payload: any;
  try {
    const ticket = await new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch { throw unauthorized('Google credential could not be verified.'); }
  if (!payload?.email || payload.email_verified !== true) throw unauthorized('Google account email is not verified.');
  const user: any = await User.findOne({ email: String(payload.email).toLowerCase() }).setOptions({ skipTenant: true });
  if (!user || !user.is_active) throw unauthorized('No active account for this Google user. Ask your administrator for an invitation.');
  await withTxn((s) => writeAudit({ orgId: String(user.organisation_id), userId: String(user._id), ip, ua }, { action: 'auth.login_google', entity_type: 'User', entity_id: user._id }, s));
  return issueSession(user, null, ip);
}

export async function createInvitationToken(actor: AuditActor, userId: string, kind: 'invite' | 'reset', session?: any) {
  const raw = randomToken(32);
  await Invitation.create([{ organisation_id: actor.orgId, user_id: userId, kind, token_hash: sha256(raw), expires_at: new Date(Date.now() + 7 * 86400000), created_by: actor.userId }], { session });
  return raw;
}

export async function deliverInvitation(email: string, kind: 'invite' | 'reset', raw: string) {
  const link = `${env.APP_BASE_URL}/accept-invite?token=${encodeURIComponent(raw)}`;
  const text = kind === 'invite' ? `You have been invited to InvoiceFlow. Set your password here (valid 7 days): ${link}` : `An administrator started a password reset for your InvoiceFlow account. Set a new password here (valid 7 days): ${link}`;
  const sent = await sendMailDirect(email, kind === 'invite' ? 'You are invited to InvoiceFlow' : 'Reset your InvoiceFlow password', text).catch(() => false);
  // The link is only returned to the admin when email could not be sent.
  return sent ? { delivery: 'email' as const } : { delivery: 'manual' as const, link };
}

export async function acceptInvitation(raw: string, password: string, ip?: string, ua?: string) {
  const err = validatePassword(password); if (err) throw badRequest(err);
  const inv: any = await Invitation.findOne({ token_hash: sha256(raw || '') }).setOptions({ skipTenant: true });
  if (!inv || inv.used_at || inv.expires_at < new Date()) throw badRequest('This invitation link is invalid or has expired.', undefined, 'INVALID_INVITATION');
  const hash = await hashPassword(password);
  await withTxn(async (session) => {
    const claimed = await Invitation.findOneAndUpdate({ _id: inv._id, organisation_id: inv.organisation_id, used_at: null }, { $set: { used_at: new Date() } }, { returnDocument: 'after', session });
    if (!claimed) throw badRequest('This invitation link has already been used.', undefined, 'INVALID_INVITATION');
    await User.updateOne({ _id: inv.user_id, organisation_id: inv.organisation_id }, { $set: { password_hash: hash, is_active: true, password_changed_at: new Date(), failed_login_count: 0, locked_until: null }, $inc: { token_version: 1 } }, { session });
    await RefreshToken.updateMany({ user_id: inv.user_id, organisation_id: inv.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } }, { session });
    await writeAudit({ orgId: String(inv.organisation_id), userId: String(inv.user_id), ip, ua }, { action: inv.kind === 'invite' ? 'user.invitation_accepted' : 'user.password_reset', entity_type: 'User', entity_id: inv.user_id }, session);
  });
  const user: any = await User.findOne({ _id: inv.user_id, organisation_id: inv.organisation_id });
  return issueSession(user, null, ip);
}

export async function changePassword(actor: AuditActor, userId: string, current: string, next: string) {
  const err = validatePassword(next); if (err) throw badRequest(err);
  const user: any = await User.findOne({ _id: userId, organisation_id: actor.orgId });
  if (!user || !(await bcrypt.compare(current || '', user.password_hash || ''))) throw badRequest('Current password is incorrect.', undefined, 'WRONG_PASSWORD');
  const hash = await hashPassword(next);
  await withTxn(async (s) => {
    await User.updateOne({ _id: userId, organisation_id: actor.orgId }, { $set: { password_hash: hash, password_changed_at: new Date() } }, { session: s });
    await writeAudit(actor, { action: 'auth.password_changed', entity_type: 'User', entity_id: userId }, s);
  });
  await revokeAllSessions(actor.orgId, userId);
}
