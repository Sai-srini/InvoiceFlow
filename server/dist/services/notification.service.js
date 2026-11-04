"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailEnabled = exports.notifyMany = void 0;
exports.notify = notify;
exports.dispatchPendingEmails = dispatchPendingEmails;
exports.sendMailDirect = sendMailDirect;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
const models_1 = require("../models");
const smtpConfigured = () => !!(env_1.env.SMTP_HOST && env_1.env.SMTP_FROM);
let transport = null;
const getTransport = () => (transport ||= nodemailer_1.default.createTransport({
    host: env_1.env.SMTP_HOST, port: env_1.env.SMTP_PORT, secure: env_1.env.SMTP_PORT === 465,
    auth: env_1.env.SMTP_USER ? { user: env_1.env.SMTP_USER, pass: env_1.env.SMTP_PASS } : undefined,
}));
/** In-app notification always; email only when SMTP is configured, otherwise recorded as "undelivered" (never faked). */
async function notify(orgId, userId, n, session) {
    await models_1.Notification.create([{ organisation_id: orgId, user_id: userId, kind: n.kind, title: n.title, body: n.body,
            entity_type: n.entity_type, entity_id: n.entity_id ? String(n.entity_id) : undefined, email_state: smtpConfigured() ? 'pending' : 'undelivered' }], { session });
}
const notifyMany = (orgId, userIds, n, session) => Promise.all(Array.from(new Set(userIds.map(String))).map((u) => notify(orgId, u, n, session)));
exports.notifyMany = notifyMany;
/** Sends pending emails. Called by a worker every minute and best-effort after actions. */
async function dispatchPendingEmails(limit = 50) {
    if (!smtpConfigured())
        return { sent: 0, failed: 0 };
    const pending = await models_1.Notification.find({ email_state: 'pending' }).setOptions({ skipTenant: true }).limit(limit);
    let sent = 0, failed = 0;
    for (const n of pending) {
        const u = await models_1.User.findOne({ _id: n.user_id, organisation_id: n.organisation_id }).lean();
        if (!u) {
            n.email_state = 'failed';
            n.email_error = 'user not found';
            await n.save();
            failed++;
            continue;
        }
        try {
            await getTransport().sendMail({ from: env_1.env.SMTP_FROM, to: u.email, subject: n.title, text: `${n.body}\n\n${env_1.env.APP_BASE_URL}` });
            n.email_state = 'sent';
            sent++;
        }
        catch (e) {
            n.email_state = 'failed';
            n.email_error = String(e.message).slice(0, 300);
            failed++;
        }
        await n.save();
    }
    return { sent, failed };
}
/** Direct transactional email (invitations). Returns false when SMTP is not configured. */
async function sendMailDirect(to, subject, text) {
    if (!smtpConfigured())
        return false;
    await getTransport().sendMail({ from: env_1.env.SMTP_FROM, to, subject, text });
    return true;
}
exports.emailEnabled = smtpConfigured;
//# sourceMappingURL=notification.service.js.map