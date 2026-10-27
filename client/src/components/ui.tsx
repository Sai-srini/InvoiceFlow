import { ReactNode, useEffect, useState, createContext, useContext, useCallback } from 'react';
import { label } from '../lib/format';

export const Card = ({ title, actions, children, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean }) => (
  <section className="card">{(title || actions) && <header className="card-h"><h2>{title}</h2><div className="row">{actions}</div></header>}<div className={pad ? 'card-b' : ''}>{children}</div></section>);
export const Page = ({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) => (
  <div className="page"><header className="page-h"><div>{sub && <div className="eyebrow">{sub}</div>}<h1>{title}</h1></div><div className="row">{actions}</div></header>{children}</div>);

const TONES: Record<string, string> = {
  draft: 'gray', in_review: 'blue', approved: 'green', rejected: 'red', on_hold: 'amber', scheduled: 'blue', released: 'blue', paid: 'green', reconciled: 'green',
  pending_approval: 'amber', active: 'green', inactive: 'gray', pending: 'amber', failed: 'red', cancelled: 'gray', held: 'amber', returned: 'red',
  matched: 'green', unmatched: 'gray', exception: 'red', suggested: 'amber', classified: 'gray', ignored: 'gray', partial: 'amber', extracted: 'green', queued: 'gray', extracting: 'blue',
  needs_manual_entry: 'amber', converted: 'green', discarded: 'gray', draft_run: 'amber',
};
export const Badge = ({ status, text }: { status: string; text?: string }) => <span className={`badge ${TONES[status] || 'gray'}`}>{text || label(status)}</span>;
export const Btn = ({ kind = 'default', busy, children, ...p }: any) => <button {...p} disabled={p.disabled || busy} className={`btn ${kind} ${p.className || ''}`}>{busy ? 'Working…' : children}</button>;
export const Field = ({ label: l, hint, error, children, wide }: { label: string; hint?: string; error?: string | null; children: ReactNode; wide?: boolean }) => (
  <label className={`field ${wide ? 'wide' : ''}`}><span>{l}</span>{children}{error ? <small className="err" role="alert">{error}</small> : hint && <small>{hint}</small>}</label>);
export const Alert = ({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'ok' | 'info'; children: ReactNode }) => <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Spinner = () => <div className="muted pad">Loading…</div>;

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header><div className="modal-b">{children}</div></div></div>;
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return <div className="pager"><span className="muted">{total} total</span><div className="row"><Btn disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Btn><span>Page {page} of {pages}</span><Btn disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Btn></div></div>;
}
export const Tabs = ({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) =>
  <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}</button>)}</div>;

// ---- toasts
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => { const id = Date.now() + Math.random(); setItems((s) => [...s, { id, msg, kind }]); setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 5000); }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div></ToastCtx.Provider>;
}

/** Asks for a typed reason before a consequential action. */
export function ReasonModal({ title, prompt, confirm, min = 5, onClose, onSubmit }: { title: string; prompt: string; confirm: string; min?: number; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { if (v.trim().length < min) return setErr(`Please write at least ${min} characters.`); setBusy(true); try { await onSubmit(v.trim()); onClose(); } catch (e: any) { setErr(e.message); setBusy(false); } };
  return <Modal title={title} onClose={onClose}><Field label={prompt}><textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>{err && <Alert>{err}</Alert>}
    <div className="row end"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" busy={busy} onClick={go}>{confirm}</Btn></div></Modal>;
}

/** Side panel for looking at one record without leaving the list. Closes with Escape or the close button. */
export function Drawer({ title, sub, onClose, children }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <aside className="drawer" role="dialog" aria-label={title}>
    <header><div>{sub && <div className="eyebrow" style={{ marginBottom: 6 }}>{sub}</div>}<h2>{title}</h2></div><button className="x" onClick={onClose} aria-label="Close">×</button></header>
    <div className="body">{children}</div></aside>;
}
