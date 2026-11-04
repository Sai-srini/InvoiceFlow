"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const validate = (schema, where = 'body') => (req, _res, next) => {
    try {
        req[where] = schema.parse(req[where]);
        next();
    }
    catch (e) {
        next(e);
    }
};
exports.validate = validate;
//# sourceMappingURL=validate.js.map