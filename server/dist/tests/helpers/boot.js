"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.boot = boot;
exports.client = client;
exports.makeTextPdf = makeTextPdf;
process.env.NODE_ENV = 'test';
// Real transactions are used when TEST_REAL_TXN=1 (needs a replica set); otherwise a stand-in database without transactions is assumed.
if (!process.env.TEST_REAL_TXN)
    process.env.TXN_DISABLED = '1';
process.env.LOGIN_MAX_FAILURES = '3';
const dbName = `ift_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
process.env.MONGO_URI = (process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/').replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
process.env.UPLOAD_DIR = `/tmp/if_uploads_${dbName}`;
const mongoose_1 = __importDefault(require("mongoose"));
const http_1 = __importDefault(require("http"));
async function boot() {
    const { createApp } = await import('../../app.js');
    await mongoose_1.default.connect(process.env.MONGO_URI);
    // The stand-in test database cannot build partial indexes (real MongoDB can); skip only those.
    await Promise.all(Object.values(mongoose_1.default.models).map((m) => m.init().catch((e) => { if (!/partialFilterExpression/.test(e.message))
        throw e; })));
    const server = http_1.default.createServer(createApp());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    return {
        base,
        close: async () => { server.close(); await mongoose_1.default.connection.dropDatabase(); await mongoose_1.default.disconnect(); },
    };
}
function client(base, token) {
    const call = async (method, path, body, extraHeaders = {}) => {
        const isForm = body instanceof FormData;
        const r = await fetch(base + path, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
            body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
        const text = await r.text();
        let parsed = text;
        try {
            parsed = JSON.parse(text);
        }
        catch { /* not json */ }
        return { status: r.status, body: parsed, headers: r.headers };
    };
    return { get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b ?? {}, h), put: (p, b) => call('PUT', p, b ?? {}), patch: (p, b) => call('PATCH', p, b ?? {}), del: (p) => call('DELETE', p) };
}
/** Builds a small valid PDF containing the given text lines (Helvetica, one line per row). */
function makeTextPdf(lines) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    let y = 780;
    const content = lines.map((l) => { const t = `BT /F1 11 Tf 50 ${y} Td (${esc(l)}) Tj ET`; y -= 16; return t; }).join('\n');
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
}
//# sourceMappingURL=boot.js.map