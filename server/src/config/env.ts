import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';
const WEAK_SECRETS = ['changeme_jwt_secret', 'secret', 'changeme', 'password', '12345678'];

function required(name: string, minLen = 1): string {
  const v = (process.env[name] || '').trim();
  if (v.length < minLen || WEAK_SECRETS.includes(v)) {
    throw new Error(`FATAL: ${name} must be configured${minLen > 1 ? ` (at least ${minLen} characters)` : ''} and must not be a placeholder.`);
  }
  return v;
}

const jwtSecret = isTest
  ? process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long_for_unit_tests'
  : required('JWT_SECRET', 32);

// 32 random bytes, base64 encoded. Used for AES-256-GCM encryption of bank details.
const encKey = isTest
  ? process.env.ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64')
  : required('ENCRYPTION_KEY', 32);
if (Buffer.from(encKey, 'base64').length !== 32) {
  throw new Error('FATAL: ENCRYPTION_KEY must be 32 random bytes encoded as base64 (e.g. `openssl rand -base64 32`).');
}

// The no-transaction escape hatch exists ONLY for automated tests against a database that cannot do
// transactions. It can never be enabled outside NODE_ENV=test.
const txnDisabled = process.env.TXN_DISABLED === '1';
if (txnDisabled && !isTest) {
  throw new Error('FATAL: TXN_DISABLED=1 is only permitted when NODE_ENV=test.');
}

export const env = {
  NODE_ENV: nodeEnv,
  IS_TEST: isTest,
  IS_PROD: isProd,
  PORT: parseInt(process.env.PORT || '3001', 10),
  MONGO_URI:
    process.env.MONGO_URI ||
    'mongodb://127.0.0.1:27017/invoice_platform?replicaSet=rs0&directConnection=true',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  /** TLS DSN (rediss://…) for managed Redis such as Upstash; plain host/port still works. */
  REDIS_URL: process.env.REDIS_URL || '',
  JWT_SECRET: jwtSecret,
  ENCRYPTION_KEY: encKey,
  ACCESS_TOKEN_TTL_SECONDS: parseInt(process.env.ACCESS_TOKEN_TTL_SECONDS || '900', 10),
  REFRESH_TOKEN_TTL_DAYS: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173,http://localhost:3000',
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  APP_BASE_URL: process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
  /** When set (production single-service deploys), the built React client is served by the API process. */
  CLIENT_DIST: process.env.CLIENT_DIST || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
  OCR_ENABLED: process.env.OCR_ENABLED === '1',
  TXN_DISABLED: txnDisabled,
  // Run background jobs inline instead of via Redis queues (tests / local without Redis).
  QUEUES_INLINE: isTest || process.env.QUEUES_INLINE === '1',
  LOGIN_MAX_FAILURES: parseInt(process.env.LOGIN_MAX_FAILURES || '5', 10),
  LOGIN_LOCK_MINUTES: parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10),
};
