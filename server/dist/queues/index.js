"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerJob = void 0;
exports.enqueue = enqueue;
exports.startWorkers = startWorkers;
exports.closeQueues = closeQueues;
const bullmq_1 = require("bullmq");
const env_1 = require("../config/env");
const redis_1 = require("../config/redis");
const logger_1 = require("../lib/logger");
const handlers = new Map();
const registerJob = (name, fn) => { handlers.set(name, fn); };
exports.registerJob = registerJob;
const inlineTimers = [];
const runInline = (name) => async () => {
    const h = handlers.get(name);
    if (!h)
        return;
    try {
        await h({});
    }
    catch (e) {
        (0, logger_1.log)('error', 'job_failed', { job: name, message: e.message });
    }
};
let queue = null;
const getQueue = () => (queue ||= new bullmq_1.Queue('invoiceflow', { connection: redis_1.redisConnection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } }));
/** Runs a background job: inline in tests / no-Redis mode, otherwise through BullMQ with retries. */
async function enqueue(name, data, jobId) {
    if (env_1.env.QUEUES_INLINE) {
        const h = handlers.get(name);
        if (!h)
            throw new Error(`No handler registered for job "${name}"`);
        try {
            await h(data);
        }
        catch (e) {
            (0, logger_1.log)('error', 'inline_job_failed', { job: name, message: e.message });
        }
        return;
    }
    await getQueue().add(name, data, jobId ? { jobId } : undefined);
}
async function startWorkers() {
    if (env_1.env.QUEUES_INLINE) {
        (0, logger_1.log)('info', 'queues_inline_mode');
        // Single-service production deploys run without Redis; the repeat jobs still have to fire (in-process).
        inlineTimers.push(setInterval(runInline('approvals.escalate'), 15 * 60_000));
        inlineTimers.push(setInterval(runInline('notifications.email'), 60_000));
        return null;
    }
    const worker = new bullmq_1.Worker('invoiceflow', async (job) => {
        const h = handlers.get(job.name);
        if (!h)
            throw new Error(`No handler for ${job.name}`);
        return h(job.data);
    }, { connection: redis_1.redisConnection, concurrency: 4 });
    worker.on('failed', (job, err) => (0, logger_1.log)('error', 'job_failed', { job: job?.name, attempts: job?.attemptsMade, message: err.message }));
    const q = getQueue();
    await q.add('approvals.escalate', {}, { repeat: { every: 15 * 60_000 }, jobId: 'repeat-escalate' });
    await q.add('notifications.email', {}, { repeat: { every: 60_000 }, jobId: 'repeat-email' });
    (0, logger_1.log)('info', 'workers_started');
    return worker;
}
async function closeQueues() { inlineTimers.forEach(clearInterval); inlineTimers.length = 0; if (queue)
    await queue.close(); }
//# sourceMappingURL=index.js.map