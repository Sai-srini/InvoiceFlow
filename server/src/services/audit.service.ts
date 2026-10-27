import { ClientSession } from 'mongoose';
import { AuditLog, Counter } from '../models';
import { sha256, stableStringify } from '../lib/crypto';

export interface AuditActor { orgId: string; userId: string | null; ip?: string; ua?: string; }
export interface AuditEvent { action: string; entity_type?: string; entity_id?: any; old_values?: any; new_values?: any; metadata?: any; }

const clean = (v: any) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const GENESIS = 'GENESIS';

function digest(prev: string, e: { seq: number; org: string; actor: string | null; action: string; entity_type: any; entity_id: any; old_values: any; new_values: any; metadata: any; ip: any; ua: any; at: Date }) {
  return sha256(prev + stableStringify({ ...e, at: e.at.toISOString() }));
}

/** Append one tamper-evident entry. Call inside the SAME transaction as the change it records. */
export async function writeAudit(actor: AuditActor, e: AuditEvent, session?: ClientSession) {
  const c: any = await Counter.findOneAndUpdate({ _id: `audit:${actor.orgId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
  const seq: number = c.seq;
  let prev = GENESIS;
  if (seq > 1) {
    const last: any = await AuditLog.findOne({ organisation_id: actor.orgId, seq: seq - 1 }).session(session || null).lean();
    if (!last) throw new Error(`Audit chain is missing entry ${seq - 1}; refusing to continue the chain.`);
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
  await AuditLog.create([{
    organisation_id: actor.orgId, seq, prev_hash: prev, hash, actor_id: actor.userId || null, action: body.action,
    entity_type: body.entity_type, entity_id: body.entity_id, old_values: body.old_values, new_values: body.new_values,
    metadata: body.metadata, ip: body.ip, user_agent: body.ua, at,
  }], { session });
}

/** Recompute the whole chain for an organisation and report the first break, if any. */
export async function verifyAuditChain(orgId: string) {
  let prev = GENESIS, expected = 1, checked = 0;
  const cursor = AuditLog.find({ organisation_id: orgId }).sort({ seq: 1 }).lean().cursor();
  for await (const d of cursor as any) {
    if (d.seq !== expected) return { ok: false, checked, broken_at: expected, reason: `Entry ${expected} is missing (found ${d.seq}).` };
    if (d.prev_hash !== prev) return { ok: false, checked, broken_at: d.seq, reason: 'prev_hash does not match the previous entry.' };
    const h = digest(prev, { seq: d.seq, org: String(d.organisation_id), actor: d.actor_id ? String(d.actor_id) : null, action: d.action,
      entity_type: d.entity_type ?? null, entity_id: d.entity_id ?? null, old_values: clean(d.old_values), new_values: clean(d.new_values),
      metadata: clean(d.metadata), ip: d.ip ?? null, ua: d.user_agent ?? null, at: d.at });
    if (h !== d.hash) return { ok: false, checked, broken_at: d.seq, reason: 'Entry contents do not match its hash (the record was altered).' };
    prev = d.hash; expected++; checked++;
  }
  return { ok: true, checked, broken_at: null, reason: null };
}
