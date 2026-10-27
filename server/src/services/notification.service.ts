import nodemailer from 'nodemailer';
import { ClientSession } from 'mongoose';
import { env } from '../config/env';
import { Notification, User } from '../models';

const smtpConfigured = () => !!(env.SMTP_HOST && env.SMTP_FROM);
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
const getTransport = () => (transport ||= nodemailer.createTransport({
  host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
}));

export interface NotifyInput { kind: string; title: string; body: string; entity_type?: string; entity_id?: any; }

/** In-app notification always; email only when SMTP is configured, otherwise recorded as "undelivered" (never faked). */
export async function notify(orgId: string, userId: any, n: NotifyInput, session?: ClientSession) {
  await Notification.create([{ organisation_id: orgId, user_id: userId, kind: n.kind, title: n.title, body: n.body,
    entity_type: n.entity_type, entity_id: n.entity_id ? String(n.entity_id) : undefined, email_state: smtpConfigured() ? 'pending' : 'undelivered' }], { session });
}
export const notifyMany = (orgId: string, userIds: any[], n: NotifyInput, session?: ClientSession) =>
  Promise.all(Array.from(new Set(userIds.map(String))).map((u) => notify(orgId, u, n, session)));

/** Sends pending emails. Called by a worker every minute and best-effort after actions. */
export async function dispatchPendingEmails(limit = 50) {
  if (!smtpConfigured()) return { sent: 0, failed: 0 };
  const pending: any[] = await Notification.find({ email_state: 'pending' }).setOptions({ skipTenant: true }).limit(limit);
  let sent = 0, failed = 0;
  for (const n of pending) {
    const u: any = await User.findOne({ _id: n.user_id, organisation_id: n.organisation_id }).lean();
    if (!u) { n.email_state = 'failed'; n.email_error = 'user not found'; await n.save(); failed++; continue; }
    try {
      await getTransport().sendMail({ from: env.SMTP_FROM, to: u.email, subject: n.title, text: `${n.body}\n\n${env.APP_BASE_URL}` });
      n.email_state = 'sent'; sent++;
    } catch (e: any) { n.email_state = 'failed'; n.email_error = String(e.message).slice(0, 300); failed++; }
    await n.save();
  }
  return { sent, failed };
}

/** Direct transactional email (invitations). Returns false when SMTP is not configured. */
export async function sendMailDirect(to: string, subject: string, text: string): Promise<boolean> {
  if (!smtpConfigured()) return false;
  await getTransport().sendMail({ from: env.SMTP_FROM, to, subject, text });
  return true;
}
export const emailEnabled = smtpConfigured;
