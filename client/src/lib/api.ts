// All API access goes through here. The access token lives in memory only (never localStorage);
// the refresh token is an httpOnly cookie that the browser sends by itself.
let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const setAuthLostHandler = (fn: () => void) => { onAuthLost = fn; };

export class ApiError extends Error {
  status: number; code: string; details: any;
  constructor(status: number, code: string, message: string, details?: any) { super(message); this.status = status; this.code = code; this.details = details; }
}

let refreshing: Promise<boolean> | null = null;
export async function refreshSession(): Promise<any | null> {
  const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'invoiceflow', 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
  if (!r.ok) return null;
  const body = await r.json(); accessToken = body.access_token; return body;
}
async function tryRefresh(): Promise<boolean> {
  if (!refreshing) refreshing = refreshSession().then((b) => !!b).finally(() => { refreshing = null; });
  return refreshing;
}

export interface Opts { method?: string; body?: any; form?: FormData; raw?: boolean; noRetry?: boolean; }
export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, { method: opts.method || (opts.body !== undefined || opts.form ? 'POST' : 'GET'), headers, credentials: 'same-origin',
    body: opts.form ? opts.form : opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && !opts.noRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, { ...opts, noRetry: true });
    onAuthLost?.();
  }
  if (opts.raw) { if (!res.ok) throw await toError(res); return res as any; }
  if (!res.ok) throw await toError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
async function toError(res: Response) {
  let b: any = {}; try { b = await res.json(); } catch { /* not json */ }
  return new ApiError(res.status, b.code || 'ERROR', b.error || `Request failed (${res.status})`, b.details);
}

/** Opens a protected file (invoice document, payment file) in a new tab or downloads it. */
export async function openFile(path: string, opts: { download?: string } = {}) {
  const res: Response = await api(path, { raw: true });
  const blob = await res.blob(); const url = URL.createObjectURL(blob);
  if (opts.download) { const a = document.createElement('a'); a.href = url; a.download = opts.download; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
  else window.open(url, '_blank', 'noopener');
}
export async function blobUrl(path: string): Promise<string> { const res: Response = await api(path, { raw: true }); return URL.createObjectURL(await res.blob()); }
