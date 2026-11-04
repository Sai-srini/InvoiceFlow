"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("../lib/logger");
async function connectDB() {
    await mongoose_1.default.connect(env_1.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    (0, logger_1.log)('info', 'mongo_connected');
    // Real transactions need a replica set; fail loudly at startup instead of at the first invoice.
    if (!env_1.env.TXN_DISABLED) {
        const hello = await mongoose_1.default.connection.db.admin().command({ hello: 1 });
        if (!hello.setName && hello.msg !== 'isdbgrid') {
            throw new Error('MongoDB is not running as a replica set. Transactions are required. See README (docker compose runs rs0).');
        }
    }
}
//# sourceMappingURL=database.js.map