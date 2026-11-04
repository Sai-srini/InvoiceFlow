"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importStar(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boot_1 = require("../helpers/boot");
const world_1 = require("../helpers/world");
const models_1 = require("../../models");
let app;
let w;
(0, node_test_1.before)(async () => { app = await (0, boot_1.boot)(); w = await (0, world_1.makeWorld)(app.base); });
(0, node_test_1.after)(async () => { await app.close(); });
(0, node_test_1.default)('login: wrong password and unknown email give the same generic error', async () => {
    const a = await (0, world_1.login)(app.base, 'rohan.accounts@kaveri.test', 'Wrong-pass1!');
    const b = await (0, world_1.login)(app.base, 'nobody@kaveri.test', 'Wrong-pass1!');
    strict_1.default.equal(a.status, 401);
    strict_1.default.equal(b.status, 401);
    strict_1.default.equal(a.body.error, b.body.error);
});
(0, node_test_1.default)('login: account locks after repeated failures, even for the right password', async () => {
    const v = await (0, world_1.addUser)(app.base, w.admin.token, w.roles['Requester'], 'victim@kaveri.test', 'Victim');
    for (let i = 0; i < 3; i++)
        strict_1.default.equal((await (0, world_1.login)(app.base, v.email, 'Wrong-pass1!')).status, 401);
    const locked = await (0, world_1.login)(app.base, v.email);
    strict_1.default.equal(locked.status, 423);
    strict_1.default.equal(locked.body.code, 'ACCOUNT_LOCKED');
});
(0, node_test_1.default)('invitation: weak passwords are refused and links work only once', async () => {
    const inv = (0, world_1.ok)(await w.c(w.admin.token).post('/users/invite', { email: 'weak@kaveri.test', full_name: 'Weak Pw', role_id: w.roles['Requester'] }), 201);
    const token = new URL(inv.link).searchParams.get('token');
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/accept-invite', { token, password: 'short' })).status, 400);
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/accept-invite', { token, password: 'alllowercase1234' })).status, 400);
    (0, world_1.ok)(await (0, boot_1.client)(app.base).post('/auth/accept-invite', { token, password: world_1.PW }));
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/accept-invite', { token, password: world_1.PW })).status, 400);
});
(0, node_test_1.default)('refresh tokens rotate, reuse revokes the whole session, header is required', async () => {
    const l = await (0, world_1.login)(app.base, 'priya.approver@kaveri.test');
    (0, world_1.ok)(l);
    strict_1.default.match(l.cookie, /^if_refresh=/);
    const H = { Cookie: l.cookie, 'X-Requested-With': 'invoiceflow' };
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/refresh', {}, { Cookie: l.cookie })).status, 400); // missing CSRF header
    const r1 = await (0, boot_1.client)(app.base).post('/auth/refresh', {}, H);
    (0, world_1.ok)(r1);
    const newCookie = (r1.headers.get('set-cookie') || '').split(';')[0];
    strict_1.default.notEqual(newCookie, l.cookie);
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/refresh', {}, H)).status, 401); // old token reused => stolen
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/refresh', {}, { Cookie: newCookie, 'X-Requested-With': 'invoiceflow' })).status, 401); // family revoked
});
(0, node_test_1.default)('logout kills the refresh session', async () => {
    const l = await (0, world_1.login)(app.base, 'vikram.approver@kaveri.test');
    const H = { Cookie: l.cookie, 'X-Requested-With': 'invoiceflow' };
    (0, world_1.ok)(await (0, boot_1.client)(app.base).post('/auth/logout', {}, H));
    strict_1.default.equal((await (0, boot_1.client)(app.base).post('/auth/refresh', {}, H)).status, 401);
});
(0, node_test_1.default)('google sign-in is disabled without a client id and can never create users', async () => {
    const cfg = (0, world_1.ok)(await (0, boot_1.client)(app.base).get('/auth/config'));
    strict_1.default.equal(cfg.google_enabled, false);
    const before = await models_1.User.countDocuments({ organisation_id: w.orgId });
    const r = await (0, boot_1.client)(app.base).post('/auth/google', { credential: 'x'.repeat(40) });
    strict_1.default.equal(r.status, 404);
    const r2 = await (0, boot_1.client)(app.base).post('/auth/google', { email: 'attacker@evil.test', name: 'x' });
    strict_1.default.ok([400, 404].includes(r2.status));
    strict_1.default.equal(await models_1.User.countDocuments({ organisation_id: w.orgId }), before);
    strict_1.default.equal(await models_1.User.countDocuments({ organisation_id: w.orgId, email: 'attacker@evil.test' }), 0);
});
(0, node_test_1.default)('authentication: missing or tampered tokens are rejected', async () => {
    strict_1.default.equal((await (0, boot_1.client)(app.base).get('/invoices')).status, 401);
    strict_1.default.equal((await (0, boot_1.client)(app.base, w.head1.token + 'x').get('/invoices')).status, 401);
    strict_1.default.equal((await fetch(app.base.replace('/api', '') + '/uploads/anything.pdf')).status, 404); // no public static files exist
});
(0, node_test_1.default)('authorisation: permissions, not role names, decide access', async () => {
    const req = w.c(w.requester.token);
    strict_1.default.equal((await req.get('/users')).status, 403);
    strict_1.default.equal((await req.get('/vendors')).status, 403);
    strict_1.default.equal((await req.get('/vendors/options')).status, 200); // enough to pick a vendor, no bank details
    strict_1.default.equal((await req.post('/invoices/000000000000000000000000/approve', {})).status, 403);
    strict_1.default.equal((await w.c(w.admin.token).get('/invoices')).status, 403); // admin has NO financial permissions
    strict_1.default.equal((await w.c(w.admin.token).post('/vendors', { name: 'X Vendor' })).status, 403);
    strict_1.default.equal((await w.c(w.accounts.token).get('/users')).status, 403);
    strict_1.default.equal((await w.c(w.auditor.token).post('/payment-runs', { invoice_ids: ['000000000000000000000000'], pay_date: '2026-10-15' })).status, 403);
    strict_1.default.equal((await w.c(w.auditor.token).get('/audit')).status, 200);
    const me = (0, world_1.ok)(await req.get('/auth/me'));
    strict_1.default.ok(me.user.permissions.includes('invoice.create_own'));
    strict_1.default.ok(!me.user.permissions.includes('invoice.approve'));
});
(0, node_test_1.default)('roles: editing a role changes access immediately; unknown permissions are refused', async () => {
    const a = w.c(w.admin.token);
    strict_1.default.equal((await a.post('/roles', { name: 'Bad', permissions: ['invoice.approve', 'god.mode'] })).status, 400);
    const role = (0, world_1.ok)(await a.post('/roles', { name: 'Vendor Viewer', permissions: ['vendor.view'] }), 201);
    const u = await (0, world_1.addUser)(app.base, w.admin.token, role.id, 'vv@kaveri.test', 'V Viewer');
    strict_1.default.equal((await w.c(u.token).get('/vendors')).status, 200);
    strict_1.default.equal((await w.c(u.token).get('/payments')).status, 403);
    (0, world_1.ok)(await a.patch(`/roles/${role.id}`, { permissions: ['vendor.view', 'payment.view'] }));
    strict_1.default.equal((await w.c(u.token).get('/payments')).status, 200);
    strict_1.default.equal((await a.del(`/roles/${role.id}`)).status, 409); // still assigned
});
(0, node_test_1.default)('users: the last user-manager cannot be removed; deactivation and password change end sessions', async () => {
    const a = w.c(w.admin.token);
    const me = (0, world_1.ok)(await a.get('/auth/me'));
    strict_1.default.equal((await a.patch(`/users/${me.user.id}`, { is_active: false })).status, 409);
    strict_1.default.equal((await a.patch(`/users/${me.user.id}`, { role_id: w.roles['Auditor'] })).status, 409);
    const u = await (0, world_1.addUser)(app.base, w.admin.token, w.roles['Requester'], 'leaver@kaveri.test', 'Leaver');
    strict_1.default.equal((await w.c(u.token).get('/auth/me')).status, 200);
    (0, world_1.ok)(await a.patch(`/users/${u.id}`, { is_active: false }));
    strict_1.default.equal((await w.c(u.token).get('/auth/me')).status, 401);
    strict_1.default.equal((await (0, world_1.login)(app.base, u.email)).status, 401);
    const p = await (0, world_1.addUser)(app.base, w.admin.token, w.roles['Requester'], 'pw@kaveri.test', 'Pw Changer');
    (0, world_1.ok)(await w.c(p.token).post('/auth/change-password', { current_password: world_1.PW, new_password: 'N3w!Passw0rd-xyz' }));
    strict_1.default.equal((await w.c(p.token).get('/auth/me')).status, 401);
    strict_1.default.equal((await (0, world_1.login)(app.base, p.email, 'N3w!Passw0rd-xyz')).status, 200);
});
(0, node_test_1.default)('delegation: only approvers can be delegates; dates are validated', async () => {
    const c = w.c(w.approver1.token);
    const now = Date.now();
    strict_1.default.equal((await c.post('/delegations', { to_user: w.requester.id, starts_at: new Date(now).toISOString(), ends_at: new Date(now + 86400000).toISOString() })).status, 400);
    strict_1.default.equal((await c.post('/delegations', { to_user: w.approver2.id, starts_at: new Date(now + 86400000).toISOString(), ends_at: new Date(now).toISOString() })).status, 400);
    (0, world_1.ok)(await c.post('/delegations', { to_user: w.approver2.id, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 86400000).toISOString() }), 201);
});
//# sourceMappingURL=auth_roles.test.js.map