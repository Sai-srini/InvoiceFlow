import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client } from '../helpers/boot';
import { makeWorld, World, login, ok, PW, addUser } from '../helpers/world';
import { User } from '../../models';

let app: Awaited<ReturnType<typeof boot>>; let w: World;
before(async () => { app = await boot(); w = await makeWorld(app.base); });
after(async () => { await app.close(); });

test('login: wrong password and unknown email give the same generic error', async () => {
  const a = await login(app.base, 'rohan.accounts@kaveri.test', 'Wrong-pass1!');
  const b = await login(app.base, 'nobody@kaveri.test', 'Wrong-pass1!');
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.body.error, b.body.error);
});
test('login: account locks after repeated failures, even for the right password', async () => {
  const v = await addUser(app.base, w.admin.token, w.roles['Requester'], 'victim@kaveri.test', 'Victim');
  for (let i = 0; i < 3; i++) assert.equal((await login(app.base, v.email, 'Wrong-pass1!')).status, 401);
  const locked = await login(app.base, v.email);
  assert.equal(locked.status, 423); assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
});
test('invitation: weak passwords are refused and links work only once', async () => {
  const inv = ok(await w.c(w.admin.token).post('/users/invite', { email: 'weak@kaveri.test', full_name: 'Weak Pw', role_id: w.roles['Requester'] }), 201);
  const token = new URL(inv.link).searchParams.get('token')!;
  assert.equal((await client(app.base).post('/auth/accept-invite', { token, password: 'short' })).status, 400);
  assert.equal((await client(app.base).post('/auth/accept-invite', { token, password: 'alllowercase1234' })).status, 400);
  ok(await client(app.base).post('/auth/accept-invite', { token, password: PW }));
  assert.equal((await client(app.base).post('/auth/accept-invite', { token, password: PW })).status, 400);
});
test('refresh tokens rotate, reuse revokes the whole session, header is required', async () => {
  const l = await login(app.base, 'priya.approver@kaveri.test'); ok(l);
  assert.match(l.cookie, /^if_refresh=/);
  const H = { Cookie: l.cookie, 'X-Requested-With': 'invoiceflow' };
  assert.equal((await client(app.base).post('/auth/refresh', {}, { Cookie: l.cookie })).status, 400); // missing CSRF header
  const r1 = await client(app.base).post('/auth/refresh', {}, H); ok(r1);
  const newCookie = (r1.headers.get('set-cookie') || '').split(';')[0];
  assert.notEqual(newCookie, l.cookie);
  assert.equal((await client(app.base).post('/auth/refresh', {}, H)).status, 401);           // old token reused => stolen
  assert.equal((await client(app.base).post('/auth/refresh', {}, { Cookie: newCookie, 'X-Requested-With': 'invoiceflow' })).status, 401); // family revoked
});
test('logout kills the refresh session', async () => {
  const l = await login(app.base, 'vikram.approver@kaveri.test'); const H = { Cookie: l.cookie, 'X-Requested-With': 'invoiceflow' };
  ok(await client(app.base).post('/auth/logout', {}, H));
  assert.equal((await client(app.base).post('/auth/refresh', {}, H)).status, 401);
});
test('google sign-in is disabled without a client id and can never create users', async () => {
  const cfg = ok(await client(app.base).get('/auth/config')); assert.equal(cfg.google_enabled, false);
  const before = await User.countDocuments({ organisation_id: w.orgId });
  const r = await client(app.base).post('/auth/google', { credential: 'x'.repeat(40) });
  assert.equal(r.status, 404);
  const r2 = await client(app.base).post('/auth/google', { email: 'attacker@evil.test', name: 'x' });
  assert.ok([400, 404].includes(r2.status));
  assert.equal(await User.countDocuments({ organisation_id: w.orgId }), before);
  assert.equal(await User.countDocuments({ organisation_id: w.orgId, email: 'attacker@evil.test' }), 0);
});
test('authentication: missing or tampered tokens are rejected', async () => {
  assert.equal((await client(app.base).get('/invoices')).status, 401);
  assert.equal((await client(app.base, w.head1.token + 'x').get('/invoices')).status, 401);
  assert.equal((await fetch(app.base.replace('/api', '') + '/uploads/anything.pdf')).status, 404); // no public static files exist
});
test('authorisation: permissions, not role names, decide access', async () => {
  const req = w.c(w.requester.token);
  assert.equal((await req.get('/users')).status, 403);
  assert.equal((await req.get('/vendors')).status, 403);
  assert.equal((await req.get('/vendors/options')).status, 200);   // enough to pick a vendor, no bank details
  assert.equal((await req.post('/invoices/000000000000000000000000/approve', {})).status, 403);
  assert.equal((await w.c(w.admin.token).get('/invoices')).status, 403);     // admin has NO financial permissions
  assert.equal((await w.c(w.admin.token).post('/vendors', { name: 'X Vendor' })).status, 403);
  assert.equal((await w.c(w.accounts.token).get('/users')).status, 403);
  assert.equal((await w.c(w.auditor.token).post('/payment-runs', { invoice_ids: ['000000000000000000000000'], pay_date: '2026-10-15' })).status, 403);
  assert.equal((await w.c(w.auditor.token).get('/audit')).status, 200);
  const me = ok(await req.get('/auth/me')); assert.ok(me.user.permissions.includes('invoice.create_own')); assert.ok(!me.user.permissions.includes('invoice.approve'));
});
test('roles: editing a role changes access immediately; unknown permissions are refused', async () => {
  const a = w.c(w.admin.token);
  assert.equal((await a.post('/roles', { name: 'Bad', permissions: ['invoice.approve', 'god.mode'] })).status, 400);
  const role = ok(await a.post('/roles', { name: 'Vendor Viewer', permissions: ['vendor.view'] }), 201);
  const u = await addUser(app.base, w.admin.token, role.id, 'vv@kaveri.test', 'V Viewer');
  assert.equal((await w.c(u.token).get('/vendors')).status, 200);
  assert.equal((await w.c(u.token).get('/payments')).status, 403);
  ok(await a.patch(`/roles/${role.id}`, { permissions: ['vendor.view', 'payment.view'] }));
  assert.equal((await w.c(u.token).get('/payments')).status, 200);
  assert.equal((await a.del(`/roles/${role.id}`)).status, 409); // still assigned
});
test('users: the last user-manager cannot be removed; deactivation and password change end sessions', async () => {
  const a = w.c(w.admin.token);
  const me = ok(await a.get('/auth/me'));
  assert.equal((await a.patch(`/users/${me.user.id}`, { is_active: false })).status, 409);
  assert.equal((await a.patch(`/users/${me.user.id}`, { role_id: w.roles['Auditor'] })).status, 409);
  const u = await addUser(app.base, w.admin.token, w.roles['Requester'], 'leaver@kaveri.test', 'Leaver');
  assert.equal((await w.c(u.token).get('/auth/me')).status, 200);
  ok(await a.patch(`/users/${u.id}`, { is_active: false }));
  assert.equal((await w.c(u.token).get('/auth/me')).status, 401);
  assert.equal((await login(app.base, u.email)).status, 401);
  const p = await addUser(app.base, w.admin.token, w.roles['Requester'], 'pw@kaveri.test', 'Pw Changer');
  ok(await w.c(p.token).post('/auth/change-password', { current_password: PW, new_password: 'N3w!Passw0rd-xyz' }));
  assert.equal((await w.c(p.token).get('/auth/me')).status, 401);
  assert.equal((await login(app.base, p.email, 'N3w!Passw0rd-xyz')).status, 200);
});
test('delegation: only approvers can be delegates; dates are validated', async () => {
  const c = w.c(w.approver1.token);
  const now = Date.now();
  assert.equal((await c.post('/delegations', { to_user: w.requester.id, starts_at: new Date(now).toISOString(), ends_at: new Date(now + 86400000).toISOString() })).status, 400);
  assert.equal((await c.post('/delegations', { to_user: w.approver2.id, starts_at: new Date(now + 86400000).toISOString(), ends_at: new Date(now).toISOString() })).status, 400);
  ok(await c.post('/delegations', { to_user: w.approver2.id, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 86400000).toISOString() }), 201);
});
