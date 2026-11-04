"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notConfigured = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.AppError = void 0;
class AppError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.AppError = AppError;
const badRequest = (msg, details, code = 'BAD_REQUEST') => new AppError(400, code, msg, details);
exports.badRequest = badRequest;
const unauthorized = (msg = 'Authentication required.') => new AppError(401, 'UNAUTHENTICATED', msg);
exports.unauthorized = unauthorized;
const forbidden = (msg = 'You do not have permission to do this.', code = 'FORBIDDEN', details) => new AppError(403, code, msg, details);
exports.forbidden = forbidden;
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
exports.notFound = notFound;
const conflict = (msg, code = 'CONFLICT', details) => new AppError(409, code, msg, details);
exports.conflict = conflict;
const notConfigured = (msg) => new AppError(501, 'NOT_CONFIGURED', msg);
exports.notConfigured = notConfigured;
//# sourceMappingURL=errors.js.map