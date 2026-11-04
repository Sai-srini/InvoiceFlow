"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAudit = writeAudit;
exports.verifyAuditChain = verifyAuditChain;
const models_1 = require("../models");
const crypto_1 = require("../lib/crypto");
const clean = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const GENESIS = 'GENESIS';
function digest(prev, e) {
    return (0, crypto_1.sha256)(prev + (0, crypto_1.stableStringify)({ ...e, at: e.at.toISOString() }));
}
/** Append one tamper-evident entry. Call inside the SAME transaction as the change it records. */
async function writeAudit(actor, e, session) {
    const c = await models_1.Counter.findOneAndUpdate({ _id: `audit:${actor.orgId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    const seq = c.seq;
    let prev = GENESIS;
    if (seq > 1) {
        const last = await models_1.AuditLog.findOne({ organisation_id: actor.orgId, seq: seq - 1 }).session(session || null).lean();
        if (!last)
            throw new Error(`Audit chain is missing entry ${seq - 1}; refusing to continue the chain.`);
        prev = last.hash;
    }
    const at = new Date();
    const body = {
        seq, org: actor.orgId, actor: actor.userId ? String(actor.userId) : null, action: e.action,
        entity_type: e.entity_type ?? null, entity_id: e.entity_id != null ? String(e.entity_id) : null,
        old_values: clean(e.old_values), new_values: clean(e.new_values), metadata: clean(e.metadata),
        ip: actor.ip ?? null, ua: actor.ua ?? null, at,
    };
    const hash = digest(prev, body);
    await models_1.AuditLog.create([{
            organisation_id: actor.orgId, seq, prev_hash: prev, hash, actor_id: actor.userId || null, action: body.action,
            entity_type: body.entity_type, entity_id: body.entity_id, old_values: body.old_values, new_values: body.new_values,
            metadata: body.metadata, ip: body.ip, user_agent: body.ua, at,
        }], { session });
}
/** Recompute the whole chain for an organisation and report the first break, if any. */
async function verifyAuditChain(orgId) {
    let prev = GENESIS, expected = 1, checked = 0;
    const cursor = models_1.AuditLog.find({ organisation_id: orgId }).sort({ seq: 1 }).lean().cursor();
    for await (const d of cursor) {
        if (d.seq !== expected)
            return { ok: false, checked, broken_at: expected, reason: `Entry ${expected} is missing (found ${d.seq}).` };
        if (d.prev_hash !== prev)
            return { ok: false, checked, broken_at: d.seq, reason: 'prev_hash does not match the previous entry.' };
        const h = digest(prev, { seq: d.seq, org: String(d.organisation_id), actor: d.actor_id ? String(d.actor_id) : null, action: d.action,
            entity_type: d.entity_type ?? null, entity_id: d.entity_id ?? null, old_values: clean(d.old_values), new_values: clean(d.new_values),
            metadata: clean(d.metadata), ip: d.ip ?? null, ua: d.user_agent ?? null, at: d.at });
        if (h !== d.hash)
            return { ok: false, checked, broken_at: d.seq, reason: 'Entry contents do not match its hash (the record was altered).' };
        prev = d.hash;
        expected++;
        checked++;
    }
    return { ok: true, checked, broken_at: null, reason: null };
}
//# sourceMappingURL=audit.service.js.map