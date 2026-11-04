"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTxn = withTxn;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("../config/env");
/**
 * Runs fn inside a real MongoDB transaction (requires a replica set).
 * The session is retried automatically on transient errors by the driver.
 * TXN_DISABLED=1 (tests only, enforced in env.ts) runs fn without a session.
 */
async function withTxn(fn) {
    if (env_1.env.TXN_DISABLED)
        return fn(undefined);
    const session = await mongoose_1.default.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    }
    finally {
        await session.endSession();
    }
}
//# sourceMappingURL=txn.js.map