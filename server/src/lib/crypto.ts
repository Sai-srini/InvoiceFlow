import crypto from 'crypto';
import { env } from '../config/env';

const key = () => Buffer.from(env.ENCRYPTION_KEY, 'base64');

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [v, ivB, tagB, encB] = (payload || '').split(':');
  if (v !== 'v1' || !ivB || !tagB || !encB) throw new Error('Unsupported ciphertext format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}

export const last4 = (s: string) => (s || '').replace(/\s/g, '').slice(-4);
export const maskAccount = (l4: string | null | undefined) => (l4 ? `••••${l4}` : '');

export const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Deterministic JSON (sorted keys) for hashing. */
export function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
