"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomToken = exports.sha256 = exports.maskAccount = exports.last4 = void 0;
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.stableStringify = stableStringify;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const key = () => Buffer.from(env_1.env.ENCRYPTION_KEY, 'base64');
/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
function encryptSecret(plain) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}
function decryptSecret(payload) {
    const [v, ivB, tagB, encB] = (payload || '').split(':');
    if (v !== 'v1' || !ivB || !tagB || !encB)
        throw new Error('Unsupported ciphertext format');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
const last4 = (s) => (s || '').replace(/\s/g, '').slice(-4);
exports.last4 = last4;
const maskAccount = (l4) => (l4 ? `••••${l4}` : '');
exports.maskAccount = maskAccount;
const sha256 = (data) => crypto_1.default.createHash('sha256').update(data).digest('hex');
exports.sha256 = sha256;
const randomToken = (bytes = 32) => crypto_1.default.randomBytes(bytes).toString('base64url');
exports.randomToken = randomToken;
/** Deterministic JSON (sorted keys) for hashing. */
function stableStringify(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v === undefined ? null : v);
    if (v instanceof Date)
        return JSON.stringify(v.toISOString());
    if (Array.isArray(v))
        return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
//# sourceMappingURL=crypto.js.map