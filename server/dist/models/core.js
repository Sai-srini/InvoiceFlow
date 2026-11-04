"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Counter = exports.Delegation = exports.RefreshToken = exports.Invitation = exports.User = exports.Role = exports.Organisation = void 0;
const mongoose_1 = require("mongoose");
const plugins_1 = require("./plugins");
exports.Organisation = (0, plugins_1.model)('Organisation', new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    currency: { type: String, default: 'INR' },
    settings: {
        sod: { type: mongoose_1.Schema.Types.Mixed, default: {} },
        tax: {
            gstin: { type: String, default: null }, state_code: { type: String, default: null },
            tds_sections: [{ section: String, description: String, rate_bps: Number, threshold_minor: { type: Number, default: null }, _id: false }],
        },
        recon: {
            tolerance_minor: { type: Number, default: 0 }, date_window_days: { type: Number, default: 5 },
            classifiers: [{ pattern: String, category: String, _id: false }],
        },
        default_escalation_hours: { type: Number, default: 24 },
    },
}, { timestamps: true }), false);
exports.Role = (0, plugins_1.model)('Role', (() => {
    const s = new mongoose_1.Schema({
        key: { type: String, default: null }, name: { type: String, required: true, trim: true }, description: { type: String, default: '' },
        permissions: [{ type: String }], is_template: { type: Boolean, default: false },
    }, { timestamps: true });
    s.index({ organisation_id: 1, name: 1 }, { unique: true });
    return s;
})());
exports.User = (0, plugins_1.model)('User', (() => {
    const s = new mongoose_1.Schema({
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password_hash: { type: String, default: null },
        full_name: { type: String, required: true, trim: true },
        role_id: (0, plugins_1.oid)('Role', true),
        department: { type: String, default: null },
        departments: [{ type: String }], cost_centres: [{ type: String }], // approval scope; empty = all
        approval_limit_minor: { type: Number, default: 0 }, approval_unlimited: { type: Boolean, default: false },
        is_active: { type: Boolean, default: true },
        token_version: { type: Number, default: 0 },
        failed_login_count: { type: Number, default: 0 }, locked_until: { type: Date, default: null }, last_login_at: { type: Date, default: null },
        mfa_enabled: { type: Boolean, default: false }, mfa_secret: { type: String, default: null },
        password_changed_at: { type: Date, default: null },
    }, { timestamps: true });
    return s;
})());
exports.Invitation = (0, plugins_1.model)('Invitation', new mongoose_1.Schema({
    user_id: (0, plugins_1.oid)('User', true), kind: { type: String, enum: ['invite', 'reset'], default: 'invite' },
    token_hash: { type: String, required: true, unique: true }, expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null }, created_by: (0, plugins_1.oid)('User'),
}, { timestamps: true }));
exports.RefreshToken = (0, plugins_1.model)('RefreshToken', new mongoose_1.Schema({
    user_id: (0, plugins_1.oid)('User', true), family: { type: String, required: true, index: true },
    token_hash: { type: String, required: true, unique: true }, expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null }, replaced_by: { type: String, default: null }, ip: { type: String, default: null },
}, { timestamps: true }));
exports.Delegation = (0, plugins_1.model)('Delegation', new mongoose_1.Schema({
    from_user: (0, plugins_1.oid)('User', true), to_user: (0, plugins_1.oid)('User', true),
    starts_at: { type: Date, required: true }, ends_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null }, created_by: (0, plugins_1.oid)('User'), reason: { type: String, default: '' },
}, { timestamps: true }));
exports.Counter = (0, plugins_1.model)('Counter', new mongoose_1.Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }), false);
//# sourceMappingURL=core.js.map