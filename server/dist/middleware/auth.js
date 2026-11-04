"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.can = exports.requireAnyPermission = exports.requirePermission = exports.authenticate = void 0;
const auth_service_1 = require("../services/auth.service");
const models_1 = require("../models");
const errors_1 = require("../lib/errors");
/** Verifies the bearer token, then loads the user and CURRENT permissions from the database on every request. */
const authenticate = async (req, _res, next) => {
    try {
        const h = req.headers.authorization;
        if (!h || !h.startsWith('Bearer '))
            throw (0, errors_1.unauthorized)('Authentication required.');
        let claims;
        try {
            claims = (0, auth_service_1.verifyAccess)(h.slice(7));
        }
        catch {
            throw (0, errors_1.unauthorized)('Invalid or expired token.');
        }
        const user = await models_1.User.findOne({ _id: claims.sub, organisation_id: claims.org });
        if (!user || !user.is_active || user.token_version !== claims.tv)
            throw (0, errors_1.unauthorized)('Session is no longer valid.');
        const role = await models_1.Role.findOne({ _id: user.role_id, organisation_id: claims.org }).lean();
        req.actor = {
            orgId: claims.org, userId: String(user._id), email: user.email, name: user.full_name, user,
            permissions: new Set((role?.permissions || [])),
            ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200),
        };
        next();
    }
    catch (e) {
        next(e);
    }
};
exports.authenticate = authenticate;
/** Allows the request when the user holds ALL of the listed permissions. */
const requirePermission = (...perms) => (req, _res, next) => {
    if (!req.actor)
        return next((0, errors_1.unauthorized)());
    const missing = perms.filter((p) => !req.actor.permissions.has(p));
    if (missing.length)
        return next((0, errors_1.forbidden)(`Missing permission: ${missing.join(', ')}`, 'MISSING_PERMISSION', { required: perms }));
    next();
};
exports.requirePermission = requirePermission;
/** Allows the request when the user holds AT LEAST ONE of the listed permissions. */
const requireAnyPermission = (...perms) => (req, _res, next) => {
    if (!req.actor)
        return next((0, errors_1.unauthorized)());
    if (!perms.some((p) => req.actor.permissions.has(p)))
        return next((0, errors_1.forbidden)(`Requires one of: ${perms.join(', ')}`, 'MISSING_PERMISSION', { required_any: perms }));
    next();
};
exports.requireAnyPermission = requireAnyPermission;
const can = (a, p) => a.permissions.has(p);
exports.can = can;
//# sourceMappingURL=auth.js.map