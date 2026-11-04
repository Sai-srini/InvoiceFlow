"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = void 0;
exports.validatePassword = validatePassword;
exports.verifyAccess = verifyAccess;
exports.publicUser = publicUser;
exports.login = login;
exports.refresh = refresh;
exports.logout = logout;
exports.revokeAllSessions = revokeAllSessions;
exports.googleLogin = googleLogin;
exports.createInvitationToken = createInvitationToken;
exports.deliverInvitation = deliverInvitation;
exports.acceptInvitation = acceptInvitation;
exports.changePassword = changePassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const google_auth_library_1 = require("google-auth-library");
const env_1 = require("../config/env");
const models_1 = require("../models");
const crypto_1 = require("../lib/crypto");
const errors_1 = require("../lib/errors");
const audit_service_1 = require("./audit.service");
const txn_1 = require("../lib/txn");
const notification_service_1 = require("./notification.service");
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || (env_1.env.IS_TEST ? '4' : '12'), 10);
const hashPassword = (pw) => bcryptjs_1.default.hash(pw, ROUNDS);
exports.hashPassword = hashPassword;
const DUMMY_HASH = bcryptjs_1.default.hashSync('dummy-password-for-timing', ROUNDS);
/** Returns an error message, or null when the password is acceptable. */
function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < 10)
        return 'Password must be at least 10 characters.';
    if (pw.length > 128)
        return 'Password must be at most 128 characters.';
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw))
        return 'Password needs upper and lower case letters, a number and a symbol.';
    return null;
}
function signAccess(user) {
    return jsonwebtoken_1.default.sign({ sub: String(user._id), org: String(user.organisation_id), tv: user.token_version }, env_1.env.JWT_SECRET, { expiresIn: env_1.env.ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256' });
}
function verifyAccess(token) {
    return jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET, { algorithms: ['HS256'] });
}
async function issueSession(user, family, ip) {
    const raw = (0, crypto_1.randomToken)(48);
    const fam = family || (0, crypto_1.randomToken)(12);
    await models_1.RefreshToken.create({ organisation_id: user.organisation_id, user_id: user._id, family: fam, token_hash: (0, crypto_1.sha256)(raw),
        expires_at: new Date(Date.now() + env_1.env.REFRESH_TOKEN_TTL_DAYS * 86400000), ip });
    return { accessToken: signAccess(user), refreshToken: raw, expiresIn: env_1.env.ACCESS_TOKEN_TTL_SECONDS, user };
}
async function publicUser(user) {
    const role = await models_1.Role.findOne({ _id: user.role_id, organisation_id: user.organisation_id }).lean();
    return {
        id: String(user._id), email: user.email, full_name: user.full_name, department: user.department,
        role: role ? { id: String(role._id), name: role.name } : null, permissions: (role?.permissions || []),
        approval_limit_minor: user.approval_unlimited ? null : user.approval_limit_minor, approval_unlimited: !!user.approval_unlimited,
        mfa_enabled: !!user.mfa_enabled,
    };
}
const bad = () => (0, errors_1.unauthorized)('Invalid email or password.');
async function login(email, password, ip, ua) {
    const user = await models_1.User.findOne({ email: String(email || '').toLowerCase().trim() }).setOptions({ skipTenant: true });
    const actor = user ? { orgId: String(user.organisation_id), userId: String(user._id), ip, ua } : null;
    if (!user || !user.password_hash || !user.is_active) {
        await bcryptjs_1.default.compare(String(password || ''), DUMMY_HASH);
        throw bad();
    }
    if (user.locked_until && user.locked_until > new Date())
        throw new errors_1.AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or ask an admin to reset your password.');
    const ok = await bcryptjs_1.default.compare(String(password || ''), user.password_hash);
    if (!ok) {
        const n = (user.failed_login_count || 0) + 1;
        const lock = n >= env_1.env.LOGIN_MAX_FAILURES;
        await models_1.User.updateOne({ _id: user._id, organisation_id: user.organisation_id }, { $set: { failed_login_count: lock ? 0 : n, locked_until: lock ? new Date(Date.now() + env_1.env.LOGIN_LOCK_MINUTES * 60000) : null } });
        await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: lock ? 'auth.account_locked' : 'auth.login_failed', entity_type: 'User', entity_id: user._id }, s));
        throw bad();
    }
    await models_1.User.updateOne({ _id: user._id, organisation_id: user.organisation_id }, { $set: { failed_login_count: 0, locked_until: null, last_login_at: new Date() } });
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)(actor, { action: 'auth.login', entity_type: 'User', entity_id: user._id }, s));
    return issueSession(user, null, ip);
}
async function refresh(raw, ip) {
    if (!raw)
        throw (0, errors_1.unauthorized)('No session.');
    const tok = await models_1.RefreshToken.findOne({ token_hash: (0, crypto_1.sha256)(raw) }).setOptions({ skipTenant: true });
    if (!tok)
        throw (0, errors_1.unauthorized)('Session expired. Please sign in again.');
    if (tok.revoked_at) {
        // A rotated token was presented again: treat the family as stolen and revoke all of it.
        await models_1.RefreshToken.updateMany({ family: tok.family, organisation_id: tok.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
        throw (0, errors_1.unauthorized)('Session expired. Please sign in again.');
    }
    if (tok.expires_at < new Date())
        throw (0, errors_1.unauthorized)('Session expired. Please sign in again.');
    const user = await models_1.User.findOne({ _id: tok.user_id, organisation_id: tok.organisation_id });
    if (!user || !user.is_active)
        throw (0, errors_1.unauthorized)('Account is not active.');
    tok.revoked_at = new Date();
    await tok.save();
    return issueSession(user, tok.family, ip);
}
async function logout(raw) {
    if (!raw)
        return;
    const tok = await models_1.RefreshToken.findOne({ token_hash: (0, crypto_1.sha256)(raw) }).setOptions({ skipTenant: true });
    if (tok)
        await models_1.RefreshToken.updateMany({ family: tok.family, organisation_id: tok.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
}
/** Ends every session of a user immediately (access tokens die through token_version). */
async function revokeAllSessions(orgId, userId) {
    await models_1.User.updateOne({ _id: userId, organisation_id: orgId }, { $inc: { token_version: 1 } });
    await models_1.RefreshToken.updateMany({ user_id: userId, organisation_id: orgId, revoked_at: null }, { $set: { revoked_at: new Date() } });
}
/** Google sign-in: the ID token is verified server-side. It can only sign in EXISTING active users; it never creates one. */
async function googleLogin(idToken, ip, ua) {
    if (!env_1.env.GOOGLE_CLIENT_ID)
        throw new errors_1.AppError(404, 'NOT_CONFIGURED', 'Google sign-in is not enabled.');
    if (!idToken)
        throw (0, errors_1.badRequest)('Missing Google credential.');
    let payload;
    try {
        const ticket = await new google_auth_library_1.OAuth2Client(env_1.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: env_1.env.GOOGLE_CLIENT_ID });
        payload = ticket.getPayload();
    }
    catch {
        throw (0, errors_1.unauthorized)('Google credential could not be verified.');
    }
    if (!payload?.email || payload.email_verified !== true)
        throw (0, errors_1.unauthorized)('Google account email is not verified.');
    const user = await models_1.User.findOne({ email: String(payload.email).toLowerCase() }).setOptions({ skipTenant: true });
    if (!user || !user.is_active)
        throw (0, errors_1.unauthorized)('No active account for this Google user. Ask your administrator for an invitation.');
    await (0, txn_1.withTxn)((s) => (0, audit_service_1.writeAudit)({ orgId: String(user.organisation_id), userId: String(user._id), ip, ua }, { action: 'auth.login_google', entity_type: 'User', entity_id: user._id }, s));
    return issueSession(user, null, ip);
}
async function createInvitationToken(actor, userId, kind, session) {
    const raw = (0, crypto_1.randomToken)(32);
    await models_1.Invitation.create([{ organisation_id: actor.orgId, user_id: userId, kind, token_hash: (0, crypto_1.sha256)(raw), expires_at: new Date(Date.now() + 7 * 86400000), created_by: actor.userId }], { session });
    return raw;
}
async function deliverInvitation(email, kind, raw) {
    const link = `${env_1.env.APP_BASE_URL}/accept-invite?token=${encodeURIComponent(raw)}`;
    const text = kind === 'invite' ? `You have been invited to InvoiceFlow. Set your password here (valid 7 days): ${link}` : `An administrator started a password reset for your InvoiceFlow account. Set a new password here (valid 7 days): ${link}`;
    const sent = await (0, notification_service_1.sendMailDirect)(email, kind === 'invite' ? 'You are invited to InvoiceFlow' : 'Reset your InvoiceFlow password', text).catch(() => false);
    // The link is only returned to the admin when email could not be sent.
    return sent ? { delivery: 'email' } : { delivery: 'manual', link };
}
async function acceptInvitation(raw, password, ip, ua) {
    const err = validatePassword(password);
    if (err)
        throw (0, errors_1.badRequest)(err);
    const inv = await models_1.Invitation.findOne({ token_hash: (0, crypto_1.sha256)(raw || '') }).setOptions({ skipTenant: true });
    if (!inv || inv.used_at || inv.expires_at < new Date())
        throw (0, errors_1.badRequest)('This invitation link is invalid or has expired.', undefined, 'INVALID_INVITATION');
    const hash = await (0, exports.hashPassword)(password);
    await (0, txn_1.withTxn)(async (session) => {
        const claimed = await models_1.Invitation.findOneAndUpdate({ _id: inv._id, organisation_id: inv.organisation_id, used_at: null }, { $set: { used_at: new Date() } }, { returnDocument: 'after', session });
        if (!claimed)
            throw (0, errors_1.badRequest)('This invitation link has already been used.', undefined, 'INVALID_INVITATION');
        await models_1.User.updateOne({ _id: inv.user_id, organisation_id: inv.organisation_id }, { $set: { password_hash: hash, is_active: true, password_changed_at: new Date(), failed_login_count: 0, locked_until: null }, $inc: { token_version: 1 } }, { session });
        await models_1.RefreshToken.updateMany({ user_id: inv.user_id, organisation_id: inv.organisation_id, revoked_at: null }, { $set: { revoked_at: new Date() } }, { session });
        await (0, audit_service_1.writeAudit)({ orgId: String(inv.organisation_id), userId: String(inv.user_id), ip, ua }, { action: inv.kind === 'invite' ? 'user.invitation_accepted' : 'user.password_reset', entity_type: 'User', entity_id: inv.user_id }, session);
    });
    const user = await models_1.User.findOne({ _id: inv.user_id, organisation_id: inv.organisation_id });
    return issueSession(user, null, ip);
}
async function changePassword(actor, userId, current, next) {
    const err = validatePassword(next);
    if (err)
        throw (0, errors_1.badRequest)(err);
    const user = await models_1.User.findOne({ _id: userId, organisation_id: actor.orgId });
    if (!user || !(await bcryptjs_1.default.compare(current || '', user.password_hash || '')))
        throw (0, errors_1.badRequest)('Current password is incorrect.', undefined, 'WRONG_PASSWORD');
    const hash = await (0, exports.hashPassword)(next);
    await (0, txn_1.withTxn)(async (s) => {
        await models_1.User.updateOne({ _id: userId, organisation_id: actor.orgId }, { $set: { password_hash: hash, password_changed_at: new Date() } }, { session: s });
        await (0, audit_service_1.writeAudit)(actor, { action: 'auth.password_changed', entity_type: 'User', entity_id: userId }, s);
    });
    await revokeAllSessions(actor.orgId, userId);
}
//# sourceMappingURL=auth.service.js.map