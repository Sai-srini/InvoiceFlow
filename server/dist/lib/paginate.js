"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageParams = pageParams;
exports.paginate = paginate;
function pageParams(req, defLimit = 25, maxLimit = 100) {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(String(req.query.limit || defLimit), 10) || defLimit));
    return { page, limit, skip: (page - 1) * limit };
}
async function paginate(query, countQuery, req) {
    const { page, limit, skip } = pageParams(req);
    const [data, total] = await Promise.all([query.skip(skip).limit(limit).lean(), countQuery]);
    return { data, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
//# sourceMappingURL=paginate.js.map