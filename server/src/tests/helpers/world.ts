import { client, Res } from './boot';
import { gstinCheckChar } from '../../lib/validators';

export const PW = 'Str0ng!Passw0rd';
export const gstin = (first14: string) => first14 + gstinCheckChar(first14);
export const ok = (r: Res, status = 200) => { if (r.status !== status) throw new Error(`Expected ${status} but got ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

export async function login(base: string, email: string, password = PW) {
  const r = await client(base).post('/auth/login', { email, password });
  return { ...r, token: r.body?.access_token as string, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

export async function addUser(base: string, adminToken: string, roleId: string, email: string, name: string, extra: any = {}) {
  const inv = await client(base, adminToken).post('/users/invite', { email, full_name: name, role_id: roleId, ...extra });
  ok(inv, 201);
  const token = new URL(inv.body.link).searchParams.get('token')!;
  const acc = await client(base).post('/auth/accept-invite', { token, password: PW });
  ok(acc);
  return { id: inv.body.user.id as string, token: acc.body.access_token as string, email };
}

export interface World {
  base: string; orgId: string; admin: { token: string };
  roles: Record<string, string>;
  accounts: { id: string; token: string; email: string }; approver1: any; approver2: any; head1: any; head2: any; requester: any; auditor: any;
  c: (token: string) => ReturnType<typeof client>;
}

/** Builds an organisation with one user per role template, all through the real API. */
export async function makeWorld(base: string): Promise<World> {
  const { createOrganisation } = await import('../../services/org.service.js');
  const { org } = await createOrganisation({ name: 'Kaveri Foods Pvt Ltd', adminEmail: 'admin@kaveri.test', adminName: 'Asha Admin', adminPassword: PW });
  const adminLogin = await login(base, 'admin@kaveri.test'); ok(adminLogin);
  const admin = { token: adminLogin.token };
  const roleList = ok(await client(base, admin.token).get('/roles')) as any[];
  const roles = Object.fromEntries(roleList.map((r) => [r.name, r.id]));
  const lakh = (n: number) => n * 100000 * 100;
  const accounts = await addUser(base, admin.token, roles['Accounts Team'], 'rohan.accounts@kaveri.test', 'Rohan Iyer');
  const approver1 = await addUser(base, admin.token, roles['Approver'], 'priya.approver@kaveri.test', 'Priya Nair', { approval_limit_minor: lakh(5) });
  const approver2 = await addUser(base, admin.token, roles['Approver'], 'vikram.approver@kaveri.test', 'Vikram Shah', { approval_limit_minor: lakh(20) });
  const head1 = await addUser(base, admin.token, roles['Finance Head'], 'anil.head@kaveri.test', 'Anil Kapoor', { approval_unlimited: true });
  const head2 = await addUser(base, admin.token, roles['Finance Head'], 'meera.head@kaveri.test', 'Meera Rao', { approval_unlimited: true });
  const requester = await addUser(base, admin.token, roles['Requester'], 'sam.requester@kaveri.test', 'Sam Dutta');
  const auditor = await addUser(base, admin.token, roles['Auditor'], 'ila.auditor@kaveri.test', 'Ila Menon');
  return { base, orgId: String(org._id), admin, roles, accounts, approver1, approver2, head1, head2, requester, auditor, c: (t: string) => client(base, t) };
}

export const VENDOR_GSTIN = gstin('33AAAAA0000A1Z');

/** An active vendor with bank details and the TEST1 TDS section. */
export async function makeVendor(w: World, name = 'Kaveri Packaging Works', g = VENDOR_GSTIN, account = '123456789012') {
  const v = ok(await w.c(w.accounts.token).post('/vendors', { name, gstin: g, category: 'Packaging', payment_terms_days: 15, contact_email: 'ar@vendor.test',
    bank: { account_name: name, account_number: account, ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' } }), 201);
  ok(await w.c(w.head1.token).post(`/vendors/${v.id}/approve`, {}));
  ok(await w.c(w.head1.token).patch(`/vendors/${v.id}`, { tds_section: 'TEST1' }));
  return v.id as string;
}
export async function setupTaxAndRules(w: World) {
  ok(await w.c(w.head1.token).put('/settings/tax', { gstin: null, state_code: '33', tds_sections: [{ section: 'TEST1', description: 'test section', rate_bps: 100, threshold_minor: null }] }));
  ok(await w.c(w.head1.token).post('/approval-rules', { name: 'Small', min_minor: 0, max_minor: 40000000, approvers_required: 1, mode: 'sequential', priority: 1 }), 201);
  ok(await w.c(w.head1.token).post('/approval-rules', { name: 'Large', min_minor: 40000000, max_minor: null, approvers_required: 2, mode: 'sequential', priority: 1 }), 201);
}
export const invoiceBody = (vendor_id: string, number: string, subtotal: number, extra: any = {}) => {
  const gst = Math.round(subtotal * 0.09);
  return { number, vendor_id, invoice_date: '2026-10-09', due_date: '2026-10-24', subtotal_minor: subtotal, cgst_minor: gst, sgst_minor: gst, total_minor: subtotal + 2 * gst, department: 'Packaging', ...extra };
};

/** Creates, submits and fully approves an invoice. Returns its id. */
export async function approvedInvoice(w: World, vendor: string, number: string, subtotal: number) {
  const inv = ok(await w.c(w.accounts.token).post('/invoices', invoiceBody(vendor, number, subtotal)), 201);
  const sub = ok(await w.c(w.accounts.token).post(`/invoices/${inv.id}/submit`));
  let detail = ok(await w.c(w.accounts.token).get(`/invoices/${inv.id}`));
  const tokens: Record<string, string> = { [w.approver1.id]: w.approver1.token, [w.approver2.id]: w.approver2.token, [w.head1.id]: w.head1.token, [w.head2.id]: w.head2.token };
  for (const s of [...detail.approval_steps].sort((a: any, b: any) => a.step_order - b.step_order)) ok(await w.c(tokens[s.approver_id]).post(`/invoices/${inv.id}/approve`, {}));
  detail = ok(await w.c(w.accounts.token).get(`/invoices/${inv.id}`));
  if (detail.status !== 'approved') throw new Error(`invoice ${number} should be approved, is ${detail.status} (${sub.status})`);
  return inv.id as string;
}
