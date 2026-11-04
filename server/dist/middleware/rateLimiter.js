"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authLimiter = exports.apiLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const env_1 = require("../config/env");
const redis_1 = require("../config/redis");
const store = () => {
    if (env_1.env.IS_TEST || env_1.env.QUEUES_INLINE)
        return undefined; // in-memory store
    const r = (0, redis_1.getRedis)();
    return new rate_limit_redis_1.default({ sendCommand: (...args) => r.call(...args) });
};
const apiLimiter = () => (0, express_rate_limit_1.default)({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, store: store(), message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } });
exports.apiLimiter = apiLimiter;
const authLimiter = () => (0, express_rate_limit_1.default)({ windowMs: 15 * 60_000, max: env_1.env.IS_TEST ? 1000 : 20, standardHeaders: true, legacyHeaders: false, store: store(), message: { error: 'Too many authentication attempts. Please try again later.', code: 'RATE_LIMITED' } });
exports.authLimiter = authLimiter;
//# sourceMappingURL=rateLimiter.js.map