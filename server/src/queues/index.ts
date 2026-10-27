import { Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { redisConnection } from '../config/redis';
import { log } from '../lib/logger';

type Handler = (data: any) => Promise<any>;
const handlers = new Map<string, Handler>();
export const registerJob = (name: string, fn: Handler) => { handlers.set(name, fn); };
const inlineTimers: NodeJS.Timeout[] = [];
const runInline = (name: string) => async () => {
  const h = handlers.get(name);
  if (!h) return;
  try { await h({}); } catch (e: any) { log('error', 'job_failed', { job: name, message: e.message }); }
};

let queue: Queue | null = null;
const getQueue = () => (queue ||= new Queue('invoiceflow', { connection: redisConnection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } }));

/** Runs a background job: inline in tests / no-Redis mode, otherwise through BullMQ with retries. */
export async function enqueue(name: string, data: any, jobId?: string) {
  if (env.QUEUES_INLINE) {
    const h = handlers.get(name);
    if (!h) throw new Error(`No handler registered for job "${name}"`);
    try { await h(data); } catch (e: any) { log('error', 'inline_job_failed', { job: name, message: e.message }); }
    return;
  }
  await getQueue().add(name, data, jobId ? { jobId } : undefined);
}

export async function startWorkers() {
  if (env.QUEUES_INLINE) {
    log('info', 'queues_inline_mode');
    // Single-service production deploys run without Redis; the repeat jobs still have to fire (in-process).
    inlineTimers.push(setInterval(runInline('approvals.escalate'), 15 * 60_000));
    inlineTimers.push(setInterval(runInline('notifications.email'), 60_000));
    return null;
  }
  const worker = new Worker('invoiceflow', async (job) => {
    const h = handlers.get(job.name);
    if (!h) throw new Error(`No handler for ${job.name}`);
    return h(job.data);
  }, { connection: redisConnection, concurrency: 4 });
  worker.on('failed', (job, err) => log('error', 'job_failed', { job: job?.name, attempts: job?.attemptsMade, message: err.message }));
  const q = getQueue();
  await q.add('approvals.escalate', {}, { repeat: { every: 15 * 60_000 }, jobId: 'repeat-escalate' });
  await q.add('notifications.email', {}, { repeat: { every: 60_000 }, jobId: 'repeat-email' });
  log('info', 'workers_started');
  return worker;
}
export async function closeQueues() { inlineTimers.forEach(clearInterval); inlineTimers.length = 0; if (queue) await queue.close(); }
