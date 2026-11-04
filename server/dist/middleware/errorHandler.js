"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.asyncHandler = void 0;
const zod_1 = require("zod");
const errors_1 = require("../lib/errors");
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const asyncHandler = (fn) => (req, res, next) => { fn(req, res, next).catch(next); };
exports.asyncHandler = asyncHandler;
const errorHandler = (err, req, res, _next) => {
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION', details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })), request_id: req.requestId });
        return;
    }
    if (err instanceof errors_1.AppError) {
        res.status(err.status).json({ error: err.message, code: err.code, details: err.details, request_id: req.requestId });
        return;
    }
    if (err?.code === 11000) {
        res.status(409).json({ error: 'A record with the same unique values already exists.', code: 'DUPLICATE', details: err.keyValue, request_id: req.requestId });
        return;
    }
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ error: 'Request body too large.', code: 'TOO_LARGE' });
        return;
    }
    if (err?.name === 'MulterError') {
        res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
        return;
    }
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
        res.status(400).json({ error: err.message, code: 'VALIDATION' });
        return;
    }
    (0, logger_1.log)('error', 'unhandled_error', { request_id: req.requestId, method: req.method, path: req.path, message: err?.message, stack: env_1.env.IS_PROD ? undefined : err?.stack });
    res.status(500).json({ error: env_1.env.IS_PROD ? 'Internal server error' : String(err?.message || err), code: 'INTERNAL', request_id: req.requestId });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map