import { Router, Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { authenticate, requirePermission as need, requireAnyPermission as needAny } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { S, idParam as id } from './schemas';
import * as auth from '../services/auth.service';
import * as users from '../services/user.service';
import * as vendors from '../services/vendor.service';
import * as invoices from '../services/invoice.service';
import * as approvals from '../services/approval.service';
import * as runs from '../services/paymentRun.service';
import * as recon from '../services/reconciliation.service';
import * as intake from '../services/intake.service';
import * as reports from '../services/report.service';
import { verifyAuditChain } from '../services/audit.service';
import { Notification } from '../models';
import { sendCsv } from '../lib/csv';
import { validateFileMagicBytes } from '../services/storage/fileValidator';
import { badRequest, notFound, AppError } from '../lib/errors';
import { formatMinor } from '../lib/money';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_TEMPLATES } from '../domain/permissions';
import { emailEnabled } from '../services/notification.service';
import { redisStatus } from '../config/redis';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_FILE_SIZE, files: 1 } });
const REFRESH_COOKIE = 'if_refresh';
const cookieOpts = { httpOnly: true, secure: env.IS_PROD, sameSite: 'strict' as const, path: '/api/auth', maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400000 };
const needsHeader = (req: Request) => { if (req.headers['x-requested-with'] !== 'invoiceflow') throw new AppError(400, 'CSRF_HEADER', 'Missing X-Requested-With header.'); };
const sessionBody = (s: auth.Session, user: any) => ({ access_token: s.accessToken, expires_in: s.expiresIn, user });
const sendSession = async (res: Response, s: auth.Session) => { res.cookie(REFRESH_COOKIE, s.refreshToken, cookieOpts); res.json(sessionBody(s, await auth.publicUser(s.user))); };
const readCookie = (req: Request, name: string) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) || '';
const file = (req: Request) => { if (!req.file) throw badRequest('A file is required.'); return req.file; };
const A = (req: Request) => req.actor!;

export const api = Router();

// ---------------------------------------------------------------- public
api.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
api.get('/ready', asyncHandler(async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const ready = mongoOk && (env.QUEUES_INLINE || redisStatus() === 'ready');
  res.status(ready ? 200 : 503).json({ ready, mongo: mongoOk ? 'up' : 'down', redis: redisStatus(), email: emailEnabled() ? 'configured' : 'not_configured' });
}));
api.get('/auth/config', (_req, res) => res.json({ google_enabled: !!env.GOOGLE_CLIENT_ID, google_client_id: env.GOOGLE_CLIENT_ID || null }));
api.post('/auth/login', authLimiter(), validate(S.login), asyncHandler(async (req, res) => { await sendSession(res, await auth.login(req.body.email, req.body.password, req.ip, req.headers['user-agent'])); }));
api.post('/auth/google', authLimiter(), validate(S.google), asyncHandler(async (req, res) => { await sendSession(res, await auth.googleLogin(req.body.credential, req.ip, req.headers['user-agent'])); }));
api.post('/auth/accept-invite', authLimiter(), validate(S.accept), asyncHandler(async (req, res) => { await sendSession(res, await auth.acceptInvitation(req.body.token, req.body.password, req.ip, req.headers['user-agent'])); }));
api.post('/auth/refresh', asyncHandler(async (req, res) => { needsHeader(req); await sendSession(res, await auth.refresh(readCookie(req, REFRESH_COOKIE), req.ip)); }));
api.post('/auth/logout', asyncHandler(async (req, res) => { needsHeader(req); await auth.logout(readCookie(req, REFRESH_COOKIE)); res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' }); res.json({ ok: true }); }));

// ---------------------------------------------------------------- everything below needs a session
api.use(authenticate);
api.get('/auth/me', asyncHandler(async (req, res) => res.json({ user: await auth.publicUser(A(req).user) })));
api.post('/auth/change-password', validate(S.changePassword), asyncHandler(async (req, res) => { await auth.changePassword(A(req), A(req).userId, req.body.current_password, req.body.new_password); res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' }); res.json({ ok: true }); }));
api.get('/meta/permissions', (_req, res) => res.json({ permissions: ALL_PERMISSIONS.map((p) => ({ key: p, description: (PERMISSIONS as any)[p] })), templates: ROLE_TEMPLATES.map((t) => ({ key: t.key, name: t.name })) }));

// notifications
api.get('/notifications', asyncHandler(async (req, res) => { const f: any = { organisation_id: A(req).orgId, user_id: A(req).userId }; if (req.query.unread === 'true') f.read_at = null;
  res.json({ data: await Notification.find(f).sort({ createdAt: -1 }).limit(50).lean(), unread: await Notification.countDocuments({ organisation_id: A(req).orgId, user_id: A(req).userId, read_at: null }) }); }));
api.post('/notifications/read', asyncHandler(async (req, res) => { await Notification.updateMany({ organisation_id: A(req).orgId, user_id: A(req).userId, read_at: null }, { $set: { read_at: new Date() } }); res.json({ ok: true }); }));

// users, roles, delegation, settings
api.get('/users/approvers', needAny('invoice.approve', 'user.manage', 'rules.manage'), asyncHandler(async (req, res) => res.json(await users.listApprovers(A(req)))));
api.get('/users', need('user.manage'), asyncHandler(async (req, res) => res.json(await users.listUsers(A(req), req))));
api.post('/users/invite', need('user.manage'), validate(S.invite), asyncHandler(async (req, res) => res.status(201).json(await users.inviteUser(A(req), req.body))));
api.patch('/users/:id', need('user.manage'), validate(S.userPatch), asyncHandler(async (req, res) => res.json(await users.updateUser(A(req), id(req.params.id), req.body))));
api.post('/users/:id/reset-password', need('user.manage'), asyncHandler(async (req, res) => res.json(await users.startReset(A(req), id(req.params.id)))));
api.post('/users/:id/force-logout', need('user.manage'), asyncHandler(async (req, res) => { await users.forceLogout(A(req), id(req.params.id)); res.json({ ok: true }); }));
api.get('/roles', needAny('role.manage', 'user.manage', 'rules.manage'), asyncHandler(async (req, res) => res.json(await users.listRoles(A(req)))));
api.post('/roles', need('role.manage'), validate(S.role), asyncHandler(async (req, res) => res.status(201).json(await users.createRole(A(req), req.body))));
api.patch('/roles/:id', need('role.manage'), validate(S.rolePatch), asyncHandler(async (req, res) => res.json(await users.updateRole(A(req), id(req.params.id), req.body))));
api.delete('/roles/:id', need('role.manage'), asyncHandler(async (req, res) => { await users.deleteRole(A(req), id(req.params.id)); res.json({ ok: true }); }));
api.get('/delegations', needAny('invoice.approve', 'user.manage'), asyncHandler(async (req, res) => res.json(await users.listDelegations(A(req)))));
api.post('/delegations', needAny('invoice.approve', 'user.manage'), validate(S.delegation), asyncHandler(async (req, res) => res.status(201).json(await users.createDelegation(A(req), req.body))));
api.delete('/delegations/:id', needAny('invoice.approve', 'user.manage'), asyncHandler(async (req, res) => { await users.revokeDelegation(A(req), id(req.params.id)); res.json({ ok: true }); }));
api.get('/settings', asyncHandler(async (req, res) => res.json(await users.getSettings(A(req)))));
api.put('/settings/sod', need('org.settings'), validate(S.sod), asyncHandler(async (req, res) => res.json(await users.updateSettings(A(req), 'sod', req.body))));
api.put('/settings/tax', need('tax.configure'), validate(S.tax), asyncHandler(async (req, res) => res.json(await users.updateSettings(A(req), 'tax', req.body))));
api.put('/settings/recon', need('bank.configure'), validate(S.recon), asyncHandler(async (req, res) => res.json(await users.updateSettings(A(req), 'recon', req.body))));

// vendors
api.get('/vendors', need('vendor.view'), asyncHandler(async (req, res) => res.json(await vendors.listVendors(A(req), req))));
api.get('/vendors/options', needAny('vendor.view', 'invoice.create', 'invoice.create_own'), asyncHandler(async (req, res) => res.json(await vendors.listOptions(A(req)))));
api.get('/vendors/bank-changes', needAny('vendor.bank_change.approve', 'vendor.bank_change.propose'), asyncHandler(async (req, res) => res.json(await vendors.listBankChanges(A(req)))));
api.get('/vendors/:id', need('vendor.view'), asyncHandler(async (req, res) => res.json(await vendors.getVendor(A(req), id(req.params.id)))));
api.post('/vendors', need('vendor.propose'), validate(S.vendor), asyncHandler(async (req, res) => res.status(201).json(await vendors.proposeVendor(A(req), req.body))));
api.patch('/vendors/:id', needAny('vendor.propose', 'vendor.approve'), validate(S.vendorPatch), asyncHandler(async (req, res) => res.json(await vendors.updateVendor(A(req), id(req.params.id), req.body))));
api.post('/vendors/:id/approve', need('vendor.approve'), validate(S.decision), asyncHandler(async (req, res) => res.json(await vendors.decideVendor(A(req), id(req.params.id), 'approve', req.body.note))));
api.post('/vendors/:id/reject', need('vendor.approve'), validate(S.decision), asyncHandler(async (req, res) => res.json(await vendors.decideVendor(A(req), id(req.params.id), 'reject', req.body.note))));
api.post('/vendors/:id/bank-changes', need('vendor.bank_change.propose'), validate(S.bankChange), asyncHandler(async (req, res) => res.status(201).json(await vendors.proposeBankChange(A(req), id(req.params.id), req.body))));
api.post('/vendors/bank-changes/:id/approve', need('vendor.bank_change.approve'), validate(S.decision), asyncHandler(async (req, res) => res.json(await vendors.decideBankChange(A(req), id(req.params.id), 'approve', req.body.note))));
api.post('/vendors/bank-changes/:id/reject', need('vendor.bank_change.approve'), validate(S.decision), asyncHandler(async (req, res) => res.json(await vendors.decideBankChange(A(req), id(req.params.id), 'reject', req.body.note))));
api.post('/vendors/:id/reveal-bank', need('vendor.bank_reveal'), asyncHandler(async (req, res) => res.json(await vendors.revealBank(A(req), id(req.params.id)))));

// invoices
const anyInvoiceView = needAny('invoice.view_all', 'invoice.view_own', 'invoice.view_assigned', 'invoice.create', 'invoice.create_own');
api.get('/invoices', anyInvoiceView, asyncHandler(async (req, res) => {
  const out = await invoices.listInvoices(A(req), req);
  if (req.query.format === 'csv') return sendCsv(res, 'invoices.csv', ['number', 'vendor', 'status', 'invoice_date', 'due_date', 'total', 'tds', 'net_payable'],
    out.data.map((i: any) => [i.number, i.vendor_name, i.status, i.invoice_date, i.due_date, formatMinor(i.total_minor), formatMinor(i.tds_minor), formatMinor(i.net_payable_minor)]));
  res.json(out);
}));
api.post('/invoices', needAny('invoice.create', 'invoice.create_own'), validate(S.invoice), asyncHandler(async (req, res) => res.status(201).json(invoices.invoiceDto(await invoices.createInvoice(A(req), req.body)))));
api.get('/invoices/:id', anyInvoiceView, asyncHandler(async (req, res) => res.json(await invoices.getInvoiceDetail(A(req), id(req.params.id)))));
api.put('/invoices/:id', anyInvoiceView, validate(S.invoice.partial()), asyncHandler(async (req, res) => res.json(await invoices.updateInvoice(A(req), id(req.params.id), req.body))));
api.post('/invoices/:id/submit', anyInvoiceView, asyncHandler(async (req, res) => res.json(await approvals.submitInvoice(A(req), id(req.params.id)))));
api.post('/invoices/:id/approve', need('invoice.approve'), validate(S.decide), asyncHandler(async (req, res) => res.json(await approvals.decide(A(req), id(req.params.id), 'approve', req.body.comment))));
api.post('/invoices/:id/reject', need('invoice.reject'), validate(S.reason), asyncHandler(async (req, res) => res.json(await approvals.decide(A(req), id(req.params.id), 'reject', req.body.reason))));
api.post('/invoices/:id/hold', need('invoice.hold'), validate(S.reason), asyncHandler(async (req, res) => res.json(await approvals.holdInvoice(A(req), id(req.params.id), req.body.reason))));
api.post('/invoices/:id/resume', anyInvoiceView, validate(S.response), asyncHandler(async (req, res) => res.json(await approvals.resumeInvoice(A(req), id(req.params.id), req.body.response))));
api.post('/invoices/:id/reopen', anyInvoiceView, asyncHandler(async (req, res) => res.json(await approvals.reopenInvoice(A(req), id(req.params.id)))));
api.post('/invoices/:id/comments', anyInvoiceView, validate(S.comment), asyncHandler(async (req, res) => res.status(201).json(await invoices.addComment(A(req), id(req.params.id), req.body.body, req.body.kind))));
api.post('/invoices/:id/file', anyInvoiceView, upload.single('file'), asyncHandler(async (req, res) => {
  const f = file(req); const v = validateFileMagicBytes(f.buffer); if (!v.valid) throw badRequest(v.error || 'Only PDF, PNG and JPEG files are accepted.', undefined, 'INVALID_FILE');
  res.json(await invoices.attachFile(A(req), id(req.params.id), { buffer: f.buffer, name: f.originalname, mime: v.detectedMime! }));
}));
api.get('/invoices/:id/file', anyInvoiceView, asyncHandler(async (req, res) => { const f = await invoices.downloadInvoiceFile(A(req), id(req.params.id));
  res.setHeader('Content-Type', f.mime); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^A-Za-z0-9._-]/g, '_')}"`); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(f.buffer); }));
api.get('/invoices/:id/audit', needAny('audit.view', 'invoice.view_all'), asyncHandler(async (req, res) => { req.query.entity_type = 'Invoice'; req.query.entity_id = id(req.params.id); res.json(await reports.listAudit(A(req), req)); }));

// approvals
api.get('/approvals/queue', needAny('invoice.approve', 'invoice.reject', 'invoice.hold'), asyncHandler(async (req, res) => res.json(await approvals.approvalQueue(A(req), (['waiting', 'on_hold', 'decided'].includes(String(req.query.bucket)) ? String(req.query.bucket) : 'waiting') as any))));
api.get('/approval-rules', needAny('rules.manage', 'invoice.create', 'invoice.approve', 'user.manage'), asyncHandler(async (req, res) => res.json(await approvals.listRules(A(req)))));
api.post('/approval-rules', need('rules.manage'), validate(S.rule), asyncHandler(async (req, res) => res.status(201).json(await approvals.saveRule(A(req), null, req.body))));
api.put('/approval-rules/:id', need('rules.manage'), validate(S.rule), asyncHandler(async (req, res) => res.json(await approvals.saveRule(A(req), id(req.params.id), req.body))));
api.delete('/approval-rules/:id', need('rules.manage'), asyncHandler(async (req, res) => { await approvals.deleteRule(A(req), id(req.params.id)); res.json({ ok: true }); }));

// intake
api.post('/intake/upload', need('invoice.upload'), upload.single('file'), asyncHandler(async (req, res) => { const f = file(req); res.status(201).json(await intake.uploadForIntake(A(req), { buffer: f.buffer, name: f.originalname })); }));
api.get('/intake', need('invoice.review_extraction'), asyncHandler(async (req, res) => res.json(await intake.listIntake(A(req), req))));
api.get('/intake/:id', need('invoice.review_extraction'), asyncHandler(async (req, res) => res.json(await intake.getIntake(A(req), id(req.params.id)))));
api.get('/intake/:id/file', need('invoice.review_extraction'), asyncHandler(async (req, res) => { const f = await intake.downloadIntakeFile(A(req), id(req.params.id)); res.setHeader('Content-Type', f.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^A-Za-z0-9._-]/g, '_')}"`); res.send(f.buffer); }));
api.post('/intake/:id/retry', need('invoice.review_extraction'), asyncHandler(async (req, res) => res.json(await intake.retryIntake(A(req), id(req.params.id)))));
api.post('/intake/:id/discard', need('invoice.review_extraction'), asyncHandler(async (req, res) => res.json(await intake.discardIntake(A(req), id(req.params.id)))));
api.post('/intake/:id/create-invoice', need('invoice.review_extraction'), validate(S.convert), asyncHandler(async (req, res) => res.status(201).json(await intake.convertToInvoice(A(req), id(req.params.id), req.body))));

// payment runs & payments
api.get('/payment-runs', need('payment.view'), asyncHandler(async (req, res) => res.json(await runs.listRuns(A(req), req))));
api.post('/payment-runs', need('payment.prepare_run'), validate(S.run), asyncHandler(async (req, res) => res.status(201).json(await runs.prepareRun(A(req), req.body))));
api.get('/payment-runs/:id', need('payment.view'), asyncHandler(async (req, res) => res.json(await runs.getRun(A(req), id(req.params.id)))));
api.post('/payment-runs/:id/release', need('payment.release_run'), asyncHandler(async (req, res) => res.json(await runs.releaseRun(A(req), id(req.params.id)))));
api.post('/payment-runs/:id/cancel', needAny('payment.prepare_run', 'payment.release_run'), validate(S.reason), asyncHandler(async (req, res) => res.json(await runs.cancelRun(A(req), id(req.params.id), req.body.reason))));
api.get('/payment-runs/:id/file', need('payment.release_run'), asyncHandler(async (req, res) => { const f = await runs.downloadRunFile(A(req), id(req.params.id)); res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`); res.send(f.buffer); }));
api.post('/payment-runs/:id/send-to-bank', need('payment.release_run'), asyncHandler(async (_req, _res) => { await runs.notConfiguredPayoutProvider.send('x'); }));
api.get('/payments', need('payment.view'), asyncHandler(async (req, res) => res.json(await runs.listPayments(A(req), req))));
api.post('/payments/:id/hold', need('payment.hold'), validate(S.reason), asyncHandler(async (req, res) => res.json(await runs.holdPayment(A(req), id(req.params.id), req.body.reason))));
api.post('/payments/:id/release-hold', need('payment.release_hold'), validate(S.decision), asyncHandler(async (req, res) => res.json(await runs.releaseHold(A(req), id(req.params.id), req.body.note))));
api.post('/payments/:id/confirm-paid', need('payment.confirm_paid'), validate(S.confirmPaid), asyncHandler(async (req, res) => res.json(await runs.confirmPaid(A(req), id(req.params.id), req.body))));
api.post('/payments/:id/mark-failed', need('payment.confirm_paid'), validate(S.reason), asyncHandler(async (req, res) => res.json(await runs.markFailed(A(req), id(req.params.id), req.body.reason))));

// bank & reconciliation
api.get('/bank/accounts', need('bank.view'), asyncHandler(async (req, res) => res.json(await recon.listBankAccounts(A(req)))));
api.post('/bank/accounts', need('bank.configure'), validate(S.account), asyncHandler(async (req, res) => res.status(201).json(await recon.saveBankAccount(A(req), null, req.body))));
api.put('/bank/accounts/:id', need('bank.configure'), validate(S.account.partial()), asyncHandler(async (req, res) => res.json(await recon.saveBankAccount(A(req), id(req.params.id), req.body))));
api.get('/bank/profiles', need('bank.view'), asyncHandler(async (req, res) => res.json(await recon.listProfiles(A(req), req.query.bank_account_id ? String(req.query.bank_account_id) : undefined))));
api.post('/bank/profiles', need('bank.configure'), validate(S.profile), asyncHandler(async (req, res) => res.status(201).json(await recon.saveProfile(A(req), null, req.body))));
api.put('/bank/profiles/:id', need('bank.configure'), validate(S.profile), asyncHandler(async (req, res) => res.json(await recon.saveProfile(A(req), id(req.params.id), req.body))));
api.post('/bank/profiles/preview', needAny('bank.configure', 'bank.import'), upload.single('file'), asyncHandler(async (req, res) => { const p = S.profile.omit({ bank_account_id: true }).parse(JSON.parse(String(req.body.profile || '{}'))); res.json(await recon.previewParse(p, file(req).buffer)); }));
api.get('/bank/imports', need('bank.view'), asyncHandler(async (req, res) => res.json(await recon.listImports(A(req)))));
api.post('/bank/imports', need('bank.import'), upload.single('file'), asyncHandler(async (req, res) => { const f = file(req); res.status(201).json(await recon.importStatement(A(req), { bank_account_id: id(req.body.bank_account_id), profile_id: id(req.body.profile_id), file: f.buffer, file_name: f.originalname })); }));
api.get('/bank/lines', need('bank.view'), asyncHandler(async (req, res) => res.json(await recon.listLines(A(req), req))));
api.get('/bank/summary', need('bank.view'), asyncHandler(async (req, res) => res.json(await recon.reconSummary(A(req)))));
api.get('/bank/candidate-payments', need('bank.reconcile'), asyncHandler(async (req, res) => res.json(await recon.candidatePayments(A(req)))));
api.post('/bank/run-matching', need('bank.reconcile'), asyncHandler(async (req, res) => res.json(await recon.runMatching(A(req).orgId, A(req).userId))));
api.post('/bank/lines/:id/confirm-suggestion', need('bank.reconcile'), asyncHandler(async (req, res) => res.json(await recon.confirmSuggestion(A(req), id(req.params.id)))));
api.post('/bank/lines/:id/reject-suggestion', need('bank.reconcile'), asyncHandler(async (req, res) => res.json(await recon.rejectSuggestion(A(req), id(req.params.id)))));
api.post('/bank/lines/:id/match', need('bank.reconcile'), validate(S.manualMatch), asyncHandler(async (req, res) => res.json(await recon.manualMatch(A(req), id(req.params.id), req.body.allocations))));
api.post('/bank/lines/:id/approve-match', need('bank.approve_manual_match'), validate(S.decision), asyncHandler(async (req, res) => res.json(await recon.decideMatch(A(req), id(req.params.id), 'approve', req.body.note))));
api.post('/bank/lines/:id/reject-match', need('bank.approve_manual_match'), validate(S.decision), asyncHandler(async (req, res) => res.json(await recon.decideMatch(A(req), id(req.params.id), 'reject', req.body.note))));
api.post('/bank/lines/:id/unmatch', need('bank.approve_manual_match'), validate(S.reason), asyncHandler(async (req, res) => res.json(await recon.unmatch(A(req), id(req.params.id), req.body.reason))));
api.post('/bank/lines/:id/classify', need('bank.reconcile'), validate(S.classify), asyncHandler(async (req, res) => res.json(await recon.classifyLine(A(req), id(req.params.id), req.body.category ?? null, !!req.body.ignore))));

// reports
const range = (req: Request) => ({ from: req.query.from ? new Date(String(req.query.from)) : undefined, to: req.query.to ? new Date(String(req.query.to)) : undefined });
const csvOr = (res: Response, req: Request, name: string, cols: string[], rows: any[][], json: any) => (req.query.format === 'csv' ? sendCsv(res, name, cols, rows) : res.json(json));
api.get('/reports/dashboard', asyncHandler(async (req, res) => res.json(await reports.dashboard(A(req)))));
api.get('/reports/aging', needAny('report.view_ops', 'report.view_all'), asyncHandler(async (req, res) => { const r = await reports.agingReport(A(req)); csvOr(res, req, 'ap-aging.csv', ['invoice', 'vendor', 'status', 'due_date', 'net_payable', 'bucket'], r.rows.map((x: any) => [x.number, x.vendor_name, x.status, x.due_date, formatMinor(x.net_payable_minor), x.bucket]), r); }));
api.get('/reports/vendor-spend', needAny('report.view_all', 'report.view_ops'), asyncHandler(async (req, res) => { const { from, to } = range(req); const r = await reports.vendorSpend(A(req), from, to); csvOr(res, req, 'vendor-spend.csv', ['vendor', 'invoices', 'total', 'average'], r.map((x) => [x.vendor_name, x.invoice_count, formatMinor(x.total_minor), formatMinor(x.average_minor)]), r); }));
api.get('/reports/approval-turnaround', needAny('report.view_all', 'report.view_ops'), asyncHandler(async (req, res) => res.json(await reports.approvalTurnaround(A(req)))));
api.get('/reports/payments-due', needAny('report.view_ops', 'report.view_all'), asyncHandler(async (req, res) => { const r = await reports.paymentsDue(A(req)); csvOr(res, req, 'payments-due.csv', ['invoice', 'vendor', 'status', 'due_date', 'net_payable'], r.map((x) => [x.number, x.vendor_name, x.status, x.due_date, formatMinor(x.net_payable_minor)]), r); }));
api.get('/reports/cash-flow', needAny('report.view_ops', 'report.view_all'), asyncHandler(async (req, res) => res.json(await reports.cashFlowForecast(A(req), Math.min(26, parseInt(String(req.query.weeks || '8'), 10) || 8)))));
api.get('/reports/tds', need('report.view_all'), asyncHandler(async (req, res) => { const { from, to } = range(req); const r = await reports.tdsSummary(A(req), from, to); csvOr(res, req, 'tds-summary.csv', ['invoice', 'vendor', 'pan', 'section', 'taxable', 'rate_bps', 'tds', 'invoice_date'], r.rows.map((x: any) => [x.invoice_number, x.vendor_name, x.pan, x.section, formatMinor(x.taxable_minor), x.rate_bps, formatMinor(x.tds_minor), x.invoice_date]), r); }));
api.get('/reports/reconciliation', needAny('bank.view', 'report.view_all'), asyncHandler(async (req, res) => res.json(await reports.reconStatus(A(req)))));
api.get('/reports/journal-export', need('report.view_all'), asyncHandler(async (req, res) => {
  const { Invoice, Vendor } = require('../models'); const { from, to } = range(req);
  const f: any = { organisation_id: A(req).orgId, status: { $in: ['approved', 'scheduled', 'released', 'paid', 'reconciled'] } }; if (from || to) f.invoice_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const invs = await Invoice.find(f).sort({ invoice_date: 1 }).lean(); const vs = new Map((await Vendor.find({ organisation_id: A(req).orgId }).lean()).map((v: any) => [String(v._id), v.name]));
  const rows: any[][] = []; for (const i of invs as any[]) for (const l of (i.line_items?.length ? i.line_items : [{ description: i.description, amount_minor: i.subtotal_minor, gl_code: '' }])) rows.push([i.invoice_date, i.number, vs.get(String(i.vendor_id)), l.gl_code || '', l.description || '', formatMinor(l.amount_minor).replace(/[₹,]/g, ''), 'DR']);
  sendCsv(res, 'journal-export.csv', ['date', 'invoice', 'vendor', 'gl_code', 'narration', 'amount', 'dr_cr'], rows); }));

// audit
api.get('/audit', need('audit.view'), asyncHandler(async (req, res) => {
  const out = await reports.listAudit(A(req), req);
  if (req.query.format === 'csv') { if (!A(req).permissions.has('audit.export')) throw new AppError(403, 'MISSING_PERMISSION', 'Missing permission: audit.export'); return sendCsv(res, 'audit-log.csv', ['seq', 'at', 'actor', 'action', 'entity_type', 'entity_id', 'ip', 'hash'], out.data.map((a: any) => [a.seq, a.at, a.actor_name, a.action, a.entity_type, a.entity_id, a.ip, a.hash])); }
  res.json(out);
}));
api.get('/audit/verify', need('audit.view'), asyncHandler(async (req, res) => res.json(await verifyAuditChain(A(req).orgId))));
api.use((_req, _res, next) => next(notFound('Route')));
