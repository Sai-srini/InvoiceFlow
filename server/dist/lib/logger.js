"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
const env_1 = require("../config/env");
/** Structured JSON logs. Never pass secrets, tokens, passwords or account numbers here. */
function log(level, msg, extra = {}) {
    if (env_1.env.IS_TEST && level !== 'error')
        return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
    (level === 'error' ? console.error : console.log)(line);
}
//# sourceMappingURL=logger.js.map