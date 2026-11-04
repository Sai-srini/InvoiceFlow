"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.model = exports.oid = exports.minor = void 0;
exports.tenantPlugin = tenantPlugin;
exports.appendOnlyPlugin = appendOnlyPlugin;
const mongoose_1 = __importStar(require("mongoose"));
const minor = (required = false) => ({
    type: Number, required,
    validate: { validator: (v) => v === undefined || v === null || Number.isSafeInteger(v), message: 'Money must be an integer number of minor units (paise).' },
});
exports.minor = minor;
const oid = (ref, required = false) => ({ type: mongoose_1.Schema.Types.ObjectId, ref, required });
exports.oid = oid;
const OPS = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne', 'distinct'];
/**
 * Multi-tenancy safety net: every query on a tenant model MUST name organisation_id, otherwise it throws.
 * Cross-tenant system queries must opt out explicitly with .setOptions({ skipTenant: true }).
 */
function tenantPlugin(schema) {
    schema.add({ organisation_id: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true } });
    const guard = function () {
        if (this.getOptions().skipTenant)
            return;
        const f = this.getFilter();
        if (!f || f.organisation_id === undefined)
            throw new Error(`Tenant guard: a ${this.model.modelName} query is missing organisation_id.`);
    };
    OPS.forEach((op) => schema.pre(op, guard));
    schema.pre('aggregate', function () {
        if (this.options?.skipTenant)
            return;
        const first = this.pipeline()[0];
        if (!first || !first.$match || first.$match.organisation_id === undefined)
            throw new Error('Tenant guard: aggregate must start with a $match on organisation_id.');
    });
}
/** Rows can be inserted but never changed or removed through Mongoose. */
function appendOnlyPlugin(schema) {
    const block = function () { throw new Error('This collection is append-only.'); };
    ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne'].forEach((op) => schema.pre(op, block));
    schema.pre('save', function () { if (!this.isNew)
        throw new Error('This collection is append-only.'); });
}
const model = (name, schema, tenant = true) => {
    if (tenant)
        schema.plugin(tenantPlugin);
    return mongoose_1.default.models[name] || mongoose_1.default.model(name, schema);
};
exports.model = model;
//# sourceMappingURL=plugins.js.map