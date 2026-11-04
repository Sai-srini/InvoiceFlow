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
exports.api = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("../config/env");
const errorHandler_1 = require("../middleware/errorHandler");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const schemas_1 = require("./schemas");
const auth = __importStar(require("../services/auth.service"));
const users = __importStar(require("../services/user.service"));
const vendors = __importStar(require("../services/vendor.service"));
const invoices = __importStar(require("../services/invoice.service"));
const approvals = __importStar(require("../services/approval.service"));
const runs = __importStar(require("../services/paymentRun.service"));
const recon = __importStar(require("../services/reconciliation.service"));
const intake = __importStar(require("../services/intake.service"));
const reports = __importStar(require("../services/report.service"));
const audit_service_1 = require("../services/audit.service");
const models_1 = require("../models");
const csv_1 = require("../lib/csv");
const fileValidator_1 = require("../services/storage/fileValidator");
const errors_1 = require("../lib/errors");
const money_1 = require("../lib/money");
const permissions_1 = require("../domain/permissions");
const notification_service_1 = require("../services/notification.service");
const redis_1 = require("../config/redis");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: env_1.env.MAX_FILE_SIZE, files: 1 } });
const REFRESH_COOKIE = 'if_refresh';
const cookieOpts = { httpOnly: true, secure: env_1.env.IS_PROD, sameSite: 'strict', path: '/api/auth', maxAge: env_1.env.REFRESH_TOKEN_TTL_DAYS * 86400000 };
const needsHeader = (req) => { if (req.headers['x-requested-with'] !== 'invoiceflow')
    throw new errors_1.AppError(400, 'CSRF_HEADER', 'Missing X-Requested-With header.'); };
const sessionBody = (s, user) => ({ access_token: s.accessToken, expires_in: s.expiresIn, user });
const sendSession = async (res, s) => { res.cookie(REFRESH_COOKIE, s.refreshToken, cookieOpts); res.json(sessionBody(s, await auth.publicUser(s.user))); };
const readCookie = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) || '';
const file = (req) => { if (!req.file)
    throw (0, errors_1.badRequest)('A file is required.'); return req.file; };
const A = (req) => req.actor;
exports.api = (0, express_1.Router)();
// ---------------------------------------------------------------- public
exports.api.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
exports.api.get('/ready', (0, errorHandler_1.asyncHandler)(async (_req, res) => {
    const mongoOk = mongoose_1.default.connection.readyState === 1;
    const ready = mongoOk && (env_1.env.QUEUES_INLINE || (0, redis_1.redisStatus)() === 'ready');
    res.status(ready ? 200 : 503).json({ ready, mongo: mongoOk ? 'up' : 'down', redis: (0, redis_1.redisStatus)(), email: (0, notification_service_1.emailEnabled)() ? 'configured' : 'not_configured' });
}));
exports.api.get('/auth/config', (_req, res) => res.json({ google_enabled: !!env_1.env.GOOGLE_CLIENT_ID, google_client_id: env_1.env.GOOGLE_CLIENT_ID || null }));
exports.api.post('/auth/login', (0, rateLimiter_1.authLimiter)(), (0, validate_1.validate)(schemas_1.S.login), (0, errorHandler_1.asyncHandler)(async (req, res) => { await sendSession(res, await auth.login(req.body.email, req.body.password, req.ip, req.headers['user-agent'])); }));
exports.api.post('/auth/google', (0, rateLimiter_1.authLimiter)(), (0, validate_1.validate)(schemas_1.S.google), (0, errorHandler_1.asyncHandler)(async (req, res) => { await sendSession(res, await auth.googleLogin(req.body.credential, req.ip, req.headers['user-agent'])); }));
exports.api.post('/auth/accept-invite', (0, rateLimiter_1.authLimiter)(), (0, validate_1.validate)(schemas_1.S.accept), (0, errorHandler_1.asyncHandler)(async (req, res) => { await sendSession(res, await auth.acceptInvitation(req.body.token, req.body.password, req.ip, req.headers['user-agent'])); }));
exports.api.post('/auth/refresh', (0, errorHandler_1.asyncHandler)(async (req, res) => { needsHeader(req); await sendSession(res, await auth.refresh(readCookie(req, REFRESH_COOKIE), req.ip)); }));
exports.api.post('/auth/logout', (0, errorHandler_1.asyncHandler)(async (req, res) => { needsHeader(req); await auth.logout(readCookie(req, REFRESH_COOKIE)); res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' }); res.json({ ok: true }); }));
// ---------------------------------------------------------------- everything below needs a session
exports.api.use(auth_1.authenticate);
exports.api.get('/auth/me', (0, errorHandler_1.asyncHandler)(async (req, res) => res.json({ user: await auth.publicUser(A(req).user) })));
exports.api.post('/auth/change-password', (0, validate_1.validate)(schemas_1.S.changePassword), (0, errorHandler_1.asyncHandler)(async (req, res) => { await auth.changePassword(A(req), A(req).userId, req.body.current_password, req.body.new_password); res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' }); res.json({ ok: true }); }));
exports.api.get('/meta/permissions', (_req, res) => res.json({ permissions: permissions_1.ALL_PERMISSIONS.map((p) => ({ key: p, description: permissions_1.PERMISSIONS[p] })), templates: permissions_1.ROLE_TEMPLATES.map((t) => ({ key: t.key, name: t.name })) }));
// notifications
exports.api.get('/notifications', (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const f = { organisation_id: A(req).orgId, user_id: A(req).userId };
    if (req.query.unread === 'true')
        f.read_at = null;
    res.json({ data: await models_1.Notification.find(f).sort({ createdAt: -1 }).limit(50).lean(), unread: await models_1.Notification.countDocuments({ organisation_id: A(req).orgId, user_id: A(req).userId, read_at: null }) });
}));
exports.api.post('/notifications/read', (0, errorHandler_1.asyncHandler)(async (req, res) => { await models_1.Notification.updateMany({ organisation_id: A(req).orgId, user_id: A(req).userId, read_at: null }, { $set: { read_at: new Date() } }); res.json({ ok: true }); }));
// users, roles, delegation, settings
exports.api.get('/users/approvers', (0, auth_1.requireAnyPermission)('invoice.approve', 'user.manage', 'rules.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.listApprovers(A(req)))));
exports.api.get('/users', (0, auth_1.requirePermission)('user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.listUsers(A(req), req))));
exports.api.post('/users/invite', (0, auth_1.requirePermission)('user.manage'), (0, validate_1.validate)(schemas_1.S.invite), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await users.inviteUser(A(req), req.body))));
exports.api.patch('/users/:id', (0, auth_1.requirePermission)('user.manage'), (0, validate_1.validate)(schemas_1.S.userPatch), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.updateUser(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/users/:id/reset-password', (0, auth_1.requirePermission)('user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.startReset(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/users/:id/force-logout', (0, auth_1.requirePermission)('user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => { await users.forceLogout(A(req), (0, schemas_1.idParam)(req.params.id)); res.json({ ok: true }); }));
exports.api.get('/roles', (0, auth_1.requireAnyPermission)('role.manage', 'user.manage', 'rules.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.listRoles(A(req)))));
exports.api.post('/roles', (0, auth_1.requirePermission)('role.manage'), (0, validate_1.validate)(schemas_1.S.role), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await users.createRole(A(req), req.body))));
exports.api.patch('/roles/:id', (0, auth_1.requirePermission)('role.manage'), (0, validate_1.validate)(schemas_1.S.rolePatch), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.updateRole(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.delete('/roles/:id', (0, auth_1.requirePermission)('role.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => { await users.deleteRole(A(req), (0, schemas_1.idParam)(req.params.id)); res.json({ ok: true }); }));
exports.api.get('/delegations', (0, auth_1.requireAnyPermission)('invoice.approve', 'user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.listDelegations(A(req)))));
exports.api.post('/delegations', (0, auth_1.requireAnyPermission)('invoice.approve', 'user.manage'), (0, validate_1.validate)(schemas_1.S.delegation), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await users.createDelegation(A(req), req.body))));
exports.api.delete('/delegations/:id', (0, auth_1.requireAnyPermission)('invoice.approve', 'user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => { await users.revokeDelegation(A(req), (0, schemas_1.idParam)(req.params.id)); res.json({ ok: true }); }));
exports.api.get('/settings', (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.getSettings(A(req)))));
exports.api.put('/settings/sod', (0, auth_1.requirePermission)('org.settings'), (0, validate_1.validate)(schemas_1.S.sod), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.updateSettings(A(req), 'sod', req.body))));
exports.api.put('/settings/tax', (0, auth_1.requirePermission)('tax.configure'), (0, validate_1.validate)(schemas_1.S.tax), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.updateSettings(A(req), 'tax', req.body))));
exports.api.put('/settings/recon', (0, auth_1.requirePermission)('bank.configure'), (0, validate_1.validate)(schemas_1.S.recon), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await users.updateSettings(A(req), 'recon', req.body))));
// vendors
exports.api.get('/vendors', (0, auth_1.requirePermission)('vendor.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.listVendors(A(req), req))));
exports.api.get('/vendors/options', (0, auth_1.requireAnyPermission)('vendor.view', 'invoice.create', 'invoice.create_own'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.listOptions(A(req)))));
exports.api.get('/vendors/bank-changes', (0, auth_1.requireAnyPermission)('vendor.bank_change.approve', 'vendor.bank_change.propose'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.listBankChanges(A(req)))));
exports.api.get('/vendors/:id', (0, auth_1.requirePermission)('vendor.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.getVendor(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/vendors', (0, auth_1.requirePermission)('vendor.propose'), (0, validate_1.validate)(schemas_1.S.vendor), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await vendors.proposeVendor(A(req), req.body))));
exports.api.patch('/vendors/:id', (0, auth_1.requireAnyPermission)('vendor.propose', 'vendor.approve'), (0, validate_1.validate)(schemas_1.S.vendorPatch), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.updateVendor(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/vendors/:id/approve', (0, auth_1.requirePermission)('vendor.approve'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.decideVendor(A(req), (0, schemas_1.idParam)(req.params.id), 'approve', req.body.note))));
exports.api.post('/vendors/:id/reject', (0, auth_1.requirePermission)('vendor.approve'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.decideVendor(A(req), (0, schemas_1.idParam)(req.params.id), 'reject', req.body.note))));
exports.api.post('/vendors/:id/bank-changes', (0, auth_1.requirePermission)('vendor.bank_change.propose'), (0, validate_1.validate)(schemas_1.S.bankChange), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await vendors.proposeBankChange(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/vendors/bank-changes/:id/approve', (0, auth_1.requirePermission)('vendor.bank_change.approve'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.decideBankChange(A(req), (0, schemas_1.idParam)(req.params.id), 'approve', req.body.note))));
exports.api.post('/vendors/bank-changes/:id/reject', (0, auth_1.requirePermission)('vendor.bank_change.approve'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.decideBankChange(A(req), (0, schemas_1.idParam)(req.params.id), 'reject', req.body.note))));
exports.api.post('/vendors/:id/reveal-bank', (0, auth_1.requirePermission)('vendor.bank_reveal'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await vendors.revealBank(A(req), (0, schemas_1.idParam)(req.params.id)))));
// invoices
const anyInvoiceView = (0, auth_1.requireAnyPermission)('invoice.view_all', 'invoice.view_own', 'invoice.view_assigned', 'invoice.create', 'invoice.create_own');
exports.api.get('/invoices', anyInvoiceView, (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const out = await invoices.listInvoices(A(req), req);
    if (req.query.format === 'csv')
        return (0, csv_1.sendCsv)(res, 'invoices.csv', ['number', 'vendor', 'status', 'invoice_date', 'due_date', 'total', 'tds', 'net_payable'], out.data.map((i) => [i.number, i.vendor_name, i.status, i.invoice_date, i.due_date, (0, money_1.formatMinor)(i.total_minor), (0, money_1.formatMinor)(i.tds_minor), (0, money_1.formatMinor)(i.net_payable_minor)]));
    res.json(out);
}));
exports.api.post('/invoices', (0, auth_1.requireAnyPermission)('invoice.create', 'invoice.create_own'), (0, validate_1.validate)(schemas_1.S.invoice), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(invoices.invoiceDto(await invoices.createInvoice(A(req), req.body)))));
exports.api.get('/invoices/:id', anyInvoiceView, (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await invoices.getInvoiceDetail(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.put('/invoices/:id', anyInvoiceView, (0, validate_1.validate)(schemas_1.S.invoice.partial()), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await invoices.updateInvoice(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/invoices/:id/submit', anyInvoiceView, (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.submitInvoice(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/invoices/:id/approve', (0, auth_1.requirePermission)('invoice.approve'), (0, validate_1.validate)(schemas_1.S.decide), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.decide(A(req), (0, schemas_1.idParam)(req.params.id), 'approve', req.body.comment))));
exports.api.post('/invoices/:id/reject', (0, auth_1.requirePermission)('invoice.reject'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.decide(A(req), (0, schemas_1.idParam)(req.params.id), 'reject', req.body.reason))));
exports.api.post('/invoices/:id/hold', (0, auth_1.requirePermission)('invoice.hold'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.holdInvoice(A(req), (0, schemas_1.idParam)(req.params.id), req.body.reason))));
exports.api.post('/invoices/:id/resume', anyInvoiceView, (0, validate_1.validate)(schemas_1.S.response), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.resumeInvoice(A(req), (0, schemas_1.idParam)(req.params.id), req.body.response))));
exports.api.post('/invoices/:id/reopen', anyInvoiceView, (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.reopenInvoice(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/invoices/:id/comments', anyInvoiceView, (0, validate_1.validate)(schemas_1.S.comment), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await invoices.addComment(A(req), (0, schemas_1.idParam)(req.params.id), req.body.body, req.body.kind))));
exports.api.post('/invoices/:id/file', anyInvoiceView, upload.single('file'), (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const f = file(req);
    const v = (0, fileValidator_1.validateFileMagicBytes)(f.buffer);
    if (!v.valid)
        throw (0, errors_1.badRequest)(v.error || 'Only PDF, PNG and JPEG files are accepted.', undefined, 'INVALID_FILE');
    res.json(await invoices.attachFile(A(req), (0, schemas_1.idParam)(req.params.id), { buffer: f.buffer, name: f.originalname, mime: v.detectedMime }));
}));
exports.api.get('/invoices/:id/file', anyInvoiceView, (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const f = await invoices.downloadInvoiceFile(A(req), (0, schemas_1.idParam)(req.params.id));
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.buffer);
}));
exports.api.get('/invoices/:id/audit', (0, auth_1.requireAnyPermission)('audit.view', 'invoice.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => { req.query.entity_type = 'Invoice'; req.query.entity_id = (0, schemas_1.idParam)(req.params.id); res.json(await reports.listAudit(A(req), req)); }));
// approvals
exports.api.get('/approvals/queue', (0, auth_1.requireAnyPermission)('invoice.approve', 'invoice.reject', 'invoice.hold'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.approvalQueue(A(req), (['waiting', 'on_hold', 'decided'].includes(String(req.query.bucket)) ? String(req.query.bucket) : 'waiting')))));
exports.api.get('/approval-rules', (0, auth_1.requireAnyPermission)('rules.manage', 'invoice.create', 'invoice.approve', 'user.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.listRules(A(req)))));
exports.api.post('/approval-rules', (0, auth_1.requirePermission)('rules.manage'), (0, validate_1.validate)(schemas_1.S.rule), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await approvals.saveRule(A(req), null, req.body))));
exports.api.put('/approval-rules/:id', (0, auth_1.requirePermission)('rules.manage'), (0, validate_1.validate)(schemas_1.S.rule), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await approvals.saveRule(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.delete('/approval-rules/:id', (0, auth_1.requirePermission)('rules.manage'), (0, errorHandler_1.asyncHandler)(async (req, res) => { await approvals.deleteRule(A(req), (0, schemas_1.idParam)(req.params.id)); res.json({ ok: true }); }));
// intake
exports.api.post('/intake/upload', (0, auth_1.requirePermission)('invoice.upload'), upload.single('file'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const f = file(req); res.status(201).json(await intake.uploadForIntake(A(req), { buffer: f.buffer, name: f.originalname })); }));
exports.api.get('/intake', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await intake.listIntake(A(req), req))));
exports.api.get('/intake/:id', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await intake.getIntake(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.get('/intake/:id/file', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const f = await intake.downloadIntakeFile(A(req), (0, schemas_1.idParam)(req.params.id)); res.setHeader('Content-Type', f.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/[^A-Za-z0-9._-]/g, '_')}"`); res.send(f.buffer); }));
exports.api.post('/intake/:id/retry', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await intake.retryIntake(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/intake/:id/discard', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await intake.discardIntake(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/intake/:id/create-invoice', (0, auth_1.requirePermission)('invoice.review_extraction'), (0, validate_1.validate)(schemas_1.S.convert), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await intake.convertToInvoice(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
// payment runs & payments
exports.api.get('/payment-runs', (0, auth_1.requirePermission)('payment.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.listRuns(A(req), req))));
exports.api.post('/payment-runs', (0, auth_1.requirePermission)('payment.prepare_run'), (0, validate_1.validate)(schemas_1.S.run), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await runs.prepareRun(A(req), req.body))));
exports.api.get('/payment-runs/:id', (0, auth_1.requirePermission)('payment.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.getRun(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/payment-runs/:id/release', (0, auth_1.requirePermission)('payment.release_run'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.releaseRun(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/payment-runs/:id/cancel', (0, auth_1.requireAnyPermission)('payment.prepare_run', 'payment.release_run'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.cancelRun(A(req), (0, schemas_1.idParam)(req.params.id), req.body.reason))));
exports.api.get('/payment-runs/:id/file', (0, auth_1.requirePermission)('payment.release_run'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const f = await runs.downloadRunFile(A(req), (0, schemas_1.idParam)(req.params.id)); res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`); res.send(f.buffer); }));
exports.api.post('/payment-runs/:id/send-to-bank', (0, auth_1.requirePermission)('payment.release_run'), (0, errorHandler_1.asyncHandler)(async (_req, _res) => { await runs.notConfiguredPayoutProvider.send('x'); }));
exports.api.get('/payments', (0, auth_1.requirePermission)('payment.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.listPayments(A(req), req))));
exports.api.post('/payments/:id/hold', (0, auth_1.requirePermission)('payment.hold'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.holdPayment(A(req), (0, schemas_1.idParam)(req.params.id), req.body.reason))));
exports.api.post('/payments/:id/release-hold', (0, auth_1.requirePermission)('payment.release_hold'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.releaseHold(A(req), (0, schemas_1.idParam)(req.params.id), req.body.note))));
exports.api.post('/payments/:id/confirm-paid', (0, auth_1.requirePermission)('payment.confirm_paid'), (0, validate_1.validate)(schemas_1.S.confirmPaid), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.confirmPaid(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/payments/:id/mark-failed', (0, auth_1.requirePermission)('payment.confirm_paid'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await runs.markFailed(A(req), (0, schemas_1.idParam)(req.params.id), req.body.reason))));
// bank & reconciliation
exports.api.get('/bank/accounts', (0, auth_1.requirePermission)('bank.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.listBankAccounts(A(req)))));
exports.api.post('/bank/accounts', (0, auth_1.requirePermission)('bank.configure'), (0, validate_1.validate)(schemas_1.S.account), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await recon.saveBankAccount(A(req), null, req.body))));
exports.api.put('/bank/accounts/:id', (0, auth_1.requirePermission)('bank.configure'), (0, validate_1.validate)(schemas_1.S.account.partial()), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.saveBankAccount(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.get('/bank/profiles', (0, auth_1.requirePermission)('bank.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.listProfiles(A(req), req.query.bank_account_id ? String(req.query.bank_account_id) : undefined))));
exports.api.post('/bank/profiles', (0, auth_1.requirePermission)('bank.configure'), (0, validate_1.validate)(schemas_1.S.profile), (0, errorHandler_1.asyncHandler)(async (req, res) => res.status(201).json(await recon.saveProfile(A(req), null, req.body))));
exports.api.put('/bank/profiles/:id', (0, auth_1.requirePermission)('bank.configure'), (0, validate_1.validate)(schemas_1.S.profile), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.saveProfile(A(req), (0, schemas_1.idParam)(req.params.id), req.body))));
exports.api.post('/bank/profiles/preview', (0, auth_1.requireAnyPermission)('bank.configure', 'bank.import'), upload.single('file'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const p = schemas_1.S.profile.omit({ bank_account_id: true }).parse(JSON.parse(String(req.body.profile || '{}'))); res.json(await recon.previewParse(p, file(req).buffer)); }));
exports.api.get('/bank/imports', (0, auth_1.requirePermission)('bank.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.listImports(A(req)))));
exports.api.post('/bank/imports', (0, auth_1.requirePermission)('bank.import'), upload.single('file'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const f = file(req); res.status(201).json(await recon.importStatement(A(req), { bank_account_id: (0, schemas_1.idParam)(req.body.bank_account_id), profile_id: (0, schemas_1.idParam)(req.body.profile_id), file: f.buffer, file_name: f.originalname })); }));
exports.api.get('/bank/lines', (0, auth_1.requirePermission)('bank.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.listLines(A(req), req))));
exports.api.get('/bank/summary', (0, auth_1.requirePermission)('bank.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.reconSummary(A(req)))));
exports.api.get('/bank/candidate-payments', (0, auth_1.requirePermission)('bank.reconcile'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.candidatePayments(A(req)))));
exports.api.post('/bank/run-matching', (0, auth_1.requirePermission)('bank.reconcile'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.runMatching(A(req).orgId, A(req).userId))));
exports.api.post('/bank/lines/:id/confirm-suggestion', (0, auth_1.requirePermission)('bank.reconcile'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.confirmSuggestion(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/bank/lines/:id/reject-suggestion', (0, auth_1.requirePermission)('bank.reconcile'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.rejectSuggestion(A(req), (0, schemas_1.idParam)(req.params.id)))));
exports.api.post('/bank/lines/:id/match', (0, auth_1.requirePermission)('bank.reconcile'), (0, validate_1.validate)(schemas_1.S.manualMatch), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.manualMatch(A(req), (0, schemas_1.idParam)(req.params.id), req.body.allocations))));
exports.api.post('/bank/lines/:id/approve-match', (0, auth_1.requirePermission)('bank.approve_manual_match'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.decideMatch(A(req), (0, schemas_1.idParam)(req.params.id), 'approve', req.body.note))));
exports.api.post('/bank/lines/:id/reject-match', (0, auth_1.requirePermission)('bank.approve_manual_match'), (0, validate_1.validate)(schemas_1.S.decision), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.decideMatch(A(req), (0, schemas_1.idParam)(req.params.id), 'reject', req.body.note))));
exports.api.post('/bank/lines/:id/unmatch', (0, auth_1.requirePermission)('bank.approve_manual_match'), (0, validate_1.validate)(schemas_1.S.reason), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.unmatch(A(req), (0, schemas_1.idParam)(req.params.id), req.body.reason))));
exports.api.post('/bank/lines/:id/classify', (0, auth_1.requirePermission)('bank.reconcile'), (0, validate_1.validate)(schemas_1.S.classify), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await recon.classifyLine(A(req), (0, schemas_1.idParam)(req.params.id), req.body.category ?? null, !!req.body.ignore))));
// reports
const range = (req) => ({ from: req.query.from ? new Date(String(req.query.from)) : undefined, to: req.query.to ? new Date(String(req.query.to)) : undefined });
const csvOr = (res, req, name, cols, rows, json) => (req.query.format === 'csv' ? (0, csv_1.sendCsv)(res, name, cols, rows) : res.json(json));
exports.api.get('/reports/dashboard', (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await reports.dashboard(A(req)))));
exports.api.get('/reports/aging', (0, auth_1.requireAnyPermission)('report.view_ops', 'report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const r = await reports.agingReport(A(req)); csvOr(res, req, 'ap-aging.csv', ['invoice', 'vendor', 'status', 'due_date', 'net_payable', 'bucket'], r.rows.map((x) => [x.number, x.vendor_name, x.status, x.due_date, (0, money_1.formatMinor)(x.net_payable_minor), x.bucket]), r); }));
exports.api.get('/reports/vendor-spend', (0, auth_1.requireAnyPermission)('report.view_all', 'report.view_ops'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const { from, to } = range(req); const r = await reports.vendorSpend(A(req), from, to); csvOr(res, req, 'vendor-spend.csv', ['vendor', 'invoices', 'total', 'average'], r.map((x) => [x.vendor_name, x.invoice_count, (0, money_1.formatMinor)(x.total_minor), (0, money_1.formatMinor)(x.average_minor)]), r); }));
exports.api.get('/reports/approval-turnaround', (0, auth_1.requireAnyPermission)('report.view_all', 'report.view_ops'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await reports.approvalTurnaround(A(req)))));
exports.api.get('/reports/payments-due', (0, auth_1.requireAnyPermission)('report.view_ops', 'report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const r = await reports.paymentsDue(A(req)); csvOr(res, req, 'payments-due.csv', ['invoice', 'vendor', 'status', 'due_date', 'net_payable'], r.map((x) => [x.number, x.vendor_name, x.status, x.due_date, (0, money_1.formatMinor)(x.net_payable_minor)]), r); }));
exports.api.get('/reports/cash-flow', (0, auth_1.requireAnyPermission)('report.view_ops', 'report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await reports.cashFlowForecast(A(req), Math.min(26, parseInt(String(req.query.weeks || '8'), 10) || 8)))));
exports.api.get('/reports/tds', (0, auth_1.requirePermission)('report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => { const { from, to } = range(req); const r = await reports.tdsSummary(A(req), from, to); csvOr(res, req, 'tds-summary.csv', ['invoice', 'vendor', 'pan', 'section', 'taxable', 'rate_bps', 'tds', 'invoice_date'], r.rows.map((x) => [x.invoice_number, x.vendor_name, x.pan, x.section, (0, money_1.formatMinor)(x.taxable_minor), x.rate_bps, (0, money_1.formatMinor)(x.tds_minor), x.invoice_date]), r); }));
exports.api.get('/reports/reconciliation', (0, auth_1.requireAnyPermission)('bank.view', 'report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await reports.reconStatus(A(req)))));
exports.api.get('/reports/journal-export', (0, auth_1.requirePermission)('report.view_all'), (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { Invoice, Vendor } = require('../models');
    const { from, to } = range(req);
    const f = { organisation_id: A(req).orgId, status: { $in: ['approved', 'scheduled', 'released', 'paid', 'reconciled'] } };
    if (from || to)
        f.invoice_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const invs = await Invoice.find(f).sort({ invoice_date: 1 }).lean();
    const vs = new Map((await Vendor.find({ organisation_id: A(req).orgId }).lean()).map((v) => [String(v._id), v.name]));
    const rows = [];
    for (const i of invs)
        for (const l of (i.line_items?.length ? i.line_items : [{ description: i.description, amount_minor: i.subtotal_minor, gl_code: '' }]))
            rows.push([i.invoice_date, i.number, vs.get(String(i.vendor_id)), l.gl_code || '', l.description || '', (0, money_1.formatMinor)(l.amount_minor).replace(/[₹,]/g, ''), 'DR']);
    (0, csv_1.sendCsv)(res, 'journal-export.csv', ['date', 'invoice', 'vendor', 'gl_code', 'narration', 'amount', 'dr_cr'], rows);
}));
// audit
exports.api.get('/audit', (0, auth_1.requirePermission)('audit.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const out = await reports.listAudit(A(req), req);
    if (req.query.format === 'csv') {
        if (!A(req).permissions.has('audit.export'))
            throw new errors_1.AppError(403, 'MISSING_PERMISSION', 'Missing permission: audit.export');
        return (0, csv_1.sendCsv)(res, 'audit-log.csv', ['seq', 'at', 'actor', 'action', 'entity_type', 'entity_id', 'ip', 'hash'], out.data.map((a) => [a.seq, a.at, a.actor_name, a.action, a.entity_type, a.entity_id, a.ip, a.hash]));
    }
    res.json(out);
}));
exports.api.get('/audit/verify', (0, auth_1.requirePermission)('audit.view'), (0, errorHandler_1.asyncHandler)(async (req, res) => res.json(await (0, audit_service_1.verifyAuditChain)(A(req).orgId))));
exports.api.use((_req, _res, next) => next((0, errors_1.notFound)('Route')));
//# sourceMappingURL=index.js.map