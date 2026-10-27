import { env } from '../config/env';
/** Structured JSON logs. Never pass secrets, tokens, passwords or account numbers here. */
export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, any> = {}) {
  if (env.IS_TEST && level !== 'error') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === 'error' ? console.error : console.log)(line);
}
