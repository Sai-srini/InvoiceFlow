import { Invoice, Vendor, Payment, ApprovalStep, User, StatementLine, AuditLog } from '../models';
import { Actor } from '../types';
import { visibilityFilter } from './invoice.service';
import { Request } from 'express';
import { paginate } from '../lib/paginate';
import mongoose from 'mongoose';
import { applyBps } from '../lib/money';

const DAY = 86400000;
const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
const bucketOf = (due: Date, now: Date) => { const d = Math.floor((now.getTime() - due.getTime()) / DAY); return d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'; };
const OPEN = ['in_review', 'on_hold', 'approved', 'scheduled', 'released'];

export async function dashboard(actor: Actor) {
  const vis = (await visibilityFilter(actor)) || { _id: null };
  const base: any = { organisation_id: new mongoose.Types.ObjectId(actor.orgId), ...(vis._id !== undefined || vis.$or ? {} : vis) };
  const filter: any = { organisation_id: actor.orgId, ...vis };
  const invs: any[] = await Invoice.find(filter).select('status total_minor net_payable_minor due_date').lean();
  const by: Record<string, { count: number; total_minor: number }> = {};
  invs.forEach((i) => { const b = (by[i.status] ||= { count: 0, total_minor: 0 }); b.count++; b.total_minor += i.total_minor; });
  const now = new Date();
  const overdue = invs.filter((i) => OPEN.includes(i.status) && i.due_date < now);
  const myWaiting = await ApprovalStep.countDocuments({ organisation_id: actor.orgId, approver_id: actor.userId, status: 'pending' });
  const canSeePayments = actor.permissions.has('payment.view');
  const payments = canSeePayments ? await Payment.aggregate([{ $match: { organisation_id: new mongoose.Types.ObjectId(actor.orgId) } }, { $group: { _id: '$status', n: { $sum: 1 }, net: { $sum: '$net_minor' } } }]) : [];
  const exceptions = actor.permissions.has('bank.view') ? await StatementLine.countDocuments({ organisation_id: actor.orgId, status: { $in: ['exception', 'suggested', 'pending_approval'] } }) : null;
  const decided: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, status: { $in: ['approved', 'rejected'] }, decided_at: { $ne: null }, activated_at: { $ne: null } }).select('activated_at decided_at').limit(500).lean();
  const avgHours = decided.length ? decided.reduce((a, s) => a + (s.decided_at.getTime() - s.activated_at.getTime()) / 3600000, 0) / decided.length : null;
  return { invoices_by_status: by, overdue: { count: overdue.length, total_minor: overdue.reduce((a, i) => a + i.total_minor, 0) },
    awaiting_my_approval: myWaiting, payments_by_status: Object.fromEntries(payments.map((p: any) => [p._id, { count: p.n, net_minor: p.net }])),
    open_exceptions: exceptions, avg_approval_hours: avgHours === null ? null : Math.round(avgHours * 10) / 10, approvals_measured: decided.length };
}

export async function agingReport(actor: Actor) {
  const now = new Date();
  const invs: any[] = await Invoice.find({ organisation_id: actor.orgId, status: { $in: OPEN } }).lean();
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: invs.map((i) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v.name]));
  const totals: Record<string, { count: number; total_minor: number }> = Object.fromEntries(BUCKETS.map((b) => [b, { count: 0, total_minor: 0 }]));
  const rows = invs.map((i) => { const b = bucketOf(i.due_date, now); totals[b].count++; totals[b].total_minor += i.net_payable_minor; return { invoice_id: String(i._id), number: i.number, vendor_name: vendors.get(String(i.vendor_id)), status: i.status, due_date: i.due_date, net_payable_minor: i.net_payable_minor, bucket: b }; });
  return { buckets: totals, rows: rows.sort((a, b) => +a.due_date - +b.due_date) };
}

export async function vendorSpend(actor: Actor, from?: Date, to?: Date) {
  const f: any = { organisation_id: actor.orgId, status: { $in: ['approved', 'scheduled', 'released', 'paid', 'reconciled'] } };
  if (from || to) f.invoice_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const invs: any[] = await Invoice.find(f).select('vendor_id total_minor').lean();
  const agg = new Map<string, { count: number; total_minor: number }>();
  invs.forEach((i) => { const a = agg.get(String(i.vendor_id)) || { count: 0, total_minor: 0 }; a.count++; a.total_minor += i.total_minor; agg.set(String(i.vendor_id), a); });
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: Array.from(agg.keys()) } }).lean()).map((v: any) => [String(v._id), v.name]));
  return Array.from(agg.entries()).map(([id, a]) => ({ vendor_id: id, vendor_name: vendors.get(id), invoice_count: a.count, total_minor: a.total_minor, average_minor: Math.round(a.total_minor / a.count) })).sort((a, b) => b.total_minor - a.total_minor);
}

export async function approvalTurnaround(actor: Actor) {
  const steps: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, status: { $in: ['approved', 'rejected'] }, decided_at: { $ne: null }, activated_at: { $ne: null } }).lean();
  const pending: any[] = await ApprovalStep.find({ organisation_id: actor.orgId, status: 'pending' }).lean();
  const users = new Map((await User.find({ organisation_id: actor.orgId, _id: { $in: [...steps.map((s) => s.acted_by), ...pending.map((s) => s.approver_id)].filter(Boolean) } }).lean()).map((u: any) => [String(u._id), u.full_name]));
  const by = new Map<string, { decisions: number; hours: number; approved: number; rejected: number }>();
  steps.forEach((s) => { const k = String(s.acted_by || s.approver_id); const a = by.get(k) || { decisions: 0, hours: 0, approved: 0, rejected: 0 }; a.decisions++; a.hours += (s.decided_at.getTime() - s.activated_at.getTime()) / 3600000; s.status === 'approved' ? a.approved++ : a.rejected++; by.set(k, a); });
  return Array.from(by.entries()).map(([id, a]) => ({ approver_id: id, approver_name: users.get(id), decisions: a.decisions, avg_hours: Math.round((a.hours / a.decisions) * 10) / 10, approved: a.approved, rejected: a.rejected, pending: pending.filter((p) => String(p.approver_id) === id).length }));
}

export async function paymentsDue(actor: Actor) {
  const invs: any[] = await Invoice.find({ organisation_id: actor.orgId, status: { $in: ['approved', 'scheduled'] } }).sort({ due_date: 1 }).lean();
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: invs.map((i) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v.name]));
  return invs.map((i) => ({ invoice_id: String(i._id), number: i.number, vendor_name: vendors.get(String(i.vendor_id)), status: i.status, due_date: i.due_date, net_payable_minor: i.net_payable_minor }));
}

/** Cash needed per week from approved/scheduled/released invoices, by due date (overdue goes into week 0). */
export async function cashFlowForecast(actor: Actor, weeks = 8) {
  const now = new Date(); const out = Array.from({ length: weeks + 1 }, (_, w) => ({ week: w, from: new Date(now.getTime() + (w ? w - 1 : 0) * 7 * DAY), total_minor: 0, count: 0 }));
  const invs: any[] = await Invoice.find({ organisation_id: actor.orgId, status: { $in: ['approved', 'scheduled', 'released'] } }).select('due_date net_payable_minor').lean();
  invs.forEach((i) => { const d = Math.floor((i.due_date.getTime() - now.getTime()) / (7 * DAY)) + 1; const w = Math.max(0, Math.min(weeks, d)); out[w].total_minor += i.net_payable_minor; out[w].count++; });
  return out.map((o) => ({ ...o, label: o.week === 0 ? 'Overdue / this week' : `Week +${o.week}` }));
}

export async function tdsSummary(actor: Actor, from?: Date, to?: Date) {
  const f: any = { organisation_id: actor.orgId, tds_minor: { $gt: 0 }, status: { $in: ['approved', 'scheduled', 'released', 'paid', 'reconciled'] } };
  if (from || to) f.invoice_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const invs: any[] = await Invoice.find(f).lean();
  const vendors = new Map((await Vendor.find({ organisation_id: actor.orgId, _id: { $in: invs.map((i) => i.vendor_id) } }).lean()).map((v: any) => [String(v._id), v]));
  const bySection = new Map<string, { count: number; taxable_minor: number; tds_minor: number }>();
  invs.forEach((i) => { const k = i.tds_section || 'unspecified'; const a = bySection.get(k) || { count: 0, taxable_minor: 0, tds_minor: 0 }; a.count++; a.taxable_minor += i.subtotal_minor; a.tds_minor += i.tds_minor; bySection.set(k, a); });
  return { by_section: Array.from(bySection.entries()).map(([section, a]) => ({ section, ...a })),
    rows: invs.map((i) => ({ invoice_number: i.number, vendor_name: vendors.get(String(i.vendor_id))?.name, pan: vendors.get(String(i.vendor_id))?.pan, section: i.tds_section, taxable_minor: i.subtotal_minor, rate_bps: i.tds_rate_bps, tds_minor: i.tds_minor, invoice_date: i.invoice_date })) };
}

export async function reconStatus(actor: Actor) {
  const org = new mongoose.Types.ObjectId(actor.orgId);
  const lines: any[] = await StatementLine.aggregate([{ $match: { organisation_id: org } }, { $group: { _id: '$status', n: { $sum: 1 }, debit: { $sum: '$debit_minor' } } }]);
  const pay: any[] = await Payment.aggregate([{ $match: { organisation_id: org, status: { $in: ['released', 'paid'] } } }, { $group: { _id: '$reconciled', n: { $sum: 1 }, net: { $sum: '$net_minor' } } }]);
  return { lines: Object.fromEntries(lines.map((l) => [l._id, { count: l.n, debit_minor: l.debit }])), payments: { reconciled: pay.find((p) => p._id === true) || { n: 0, net: 0 }, unreconciled: pay.find((p) => p._id === false) || { n: 0, net: 0 } } };
}

export async function listAudit(actor: Actor, req: Request) {
  const f: any = { organisation_id: actor.orgId };
  for (const k of ['entity_type', 'entity_id', 'action', 'actor_id']) if (req.query[k]) f[k] = String(req.query[k]);
  if (req.query.from || req.query.to) f.at = { ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}) };
  const page = await paginate(AuditLog.find(f).sort({ seq: -1 }), AuditLog.countDocuments(f), req);
  const users = new Map((await User.find({ organisation_id: actor.orgId, _id: { $in: page.data.map((a: any) => a.actor_id).filter(Boolean) } }).lean()).map((u: any) => [String(u._id), u.full_name]));
  return { ...page, data: page.data.map((a: any) => ({ seq: a.seq, at: a.at, actor_name: a.actor_id ? users.get(String(a.actor_id)) || 'unknown' : 'system', action: a.action, entity_type: a.entity_type, entity_id: a.entity_id, old_values: a.old_values, new_values: a.new_values, metadata: a.metadata, ip: a.ip, hash: a.hash })) };
}
export { applyBps };
