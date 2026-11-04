"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./config/env");
const routes_1 = require("./routes");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimiter_1 = require("./middleware/rateLimiter");
const logger_1 = require("./lib/logger");
const workers_1 = require("./workers");
function createApp() {
    (0, workers_1.registerAllJobs)();
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', env_1.env.IS_PROD ? 1 : false);
    app.use((req, res, next) => {
        req.requestId = crypto_1.default.randomUUID();
        res.setHeader('X-Request-Id', req.requestId);
        const t = Date.now();
        res.on('finish', () => { if (!req.path.endsWith('/health'))
            (0, logger_1.log)('info', 'request', { request_id: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t }); });
        next();
    });
    app.use((0, helmet_1.default)());
    const allowed = env_1.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
    // Disallowed origins simply get no CORS headers (the browser then blocks cross-site reads); same-origin traffic is unaffected.
    app.use((0, cors_1.default)({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)), credentials: true }));
    app.use(express_1.default.json({ limit: '1mb' }));
    if (!env_1.env.IS_TEST)
        app.use('/api', (0, rateLimiter_1.apiLimiter)());
    app.use('/api', routes_1.api);
    // Single-service production deploys (Render) serve the built React client from this same origin,
    // so sessions (cookies), uploads and the API all share one https URL.
    if (env_1.env.IS_PROD && env_1.env.CLIENT_DIST) {
        const dist = path_1.default.resolve(env_1.env.CLIENT_DIST);
        app.use(express_1.default.static(dist, { index: 'index.html' }));
        app.get('*', (req, res, next) => { if (req.path.startsWith('/api'))
            return next(); res.sendFile(path_1.default.join(dist, 'index.html')); });
    }
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map