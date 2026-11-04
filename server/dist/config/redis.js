"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisStatus = exports.redisConnection = void 0;
exports.getRedis = getRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = require("../lib/logger");
let client = null;
/** Managed hosts (Upstash: TLS-only) come in as a DSN; Docker keeps using host/port. */
const dsn = env_1.env.REDIS_URL;
function sharedDsnClient() {
    client = new ioredis_1.default(dsn, { maxRetriesPerRequest: 3, lazyConnect: false });
    client.on('error', (e) => (0, logger_1.log)('error', 'redis_error', { message: e.message }));
    return client;
}
exports.redisConnection = dsn ? sharedDsnClient() : { host: env_1.env.REDIS_HOST, port: env_1.env.REDIS_PORT, password: env_1.env.REDIS_PASSWORD, maxRetriesPerRequest: null };
/** Redis is created lazily so unit tests and inline-queue mode never need it. */
function getRedis() {
    if (dsn)
        return client ?? sharedDsnClient();
    if (!client) {
        client = new ioredis_1.default({ host: env_1.env.REDIS_HOST, port: env_1.env.REDIS_PORT, password: env_1.env.REDIS_PASSWORD, maxRetriesPerRequest: 3, lazyConnect: false });
        client.on('error', (e) => (0, logger_1.log)('error', 'redis_error', { message: e.message }));
    }
    return client;
}
const redisStatus = () => (client ? client.status : env_1.env.QUEUES_INLINE ? 'inline-mode' : 'not-started');
exports.redisStatus = redisStatus;
//# sourceMappingURL=redis.js.map