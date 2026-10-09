import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { bullConnection } from '../config/redis.js';

const connection = bullConnection;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 }, // keep last 100 completed jobs in Redis
  removeOnFail:    { count: 500 }, // keep last 500 failed jobs for inspection
};

export const classifyQueue = new Queue('classify', {
  connection,
  prefix: env.REDIS_BULL_PREFIX,
  defaultJobOptions,
});

export const generateQueue = new Queue('generate', {
  connection,
  prefix: env.REDIS_BULL_PREFIX,
  defaultJobOptions,
});

export const postReplyQueue = new Queue('post-reply', {
  connection,
  prefix: env.REDIS_BULL_PREFIX,
  defaultJobOptions,
});

// ─── Per-job enqueue helpers ───────────────────────────────────────────────

export const enqueueClassifyJob = (data, opts = {}) =>
  classifyQueue.add('classify', data, opts);

export const enqueueGenerateJob = (data, opts = {}) =>
  generateQueue.add('generate', data, opts);

export const enqueuePostReplyJob = (data, opts = {}) =>
  postReplyQueue.add('post-reply', data, opts);

// ─── Bulk helpers (efficient for large batches) ────────────────────────────

export const enqueueClassifyBulk = (jobs) =>
  classifyQueue.addBulk(jobs); // jobs = [{ name, data, opts }]

export async function getJobStatus(jobId) {
  
  for (const queue of [classifyQueue, generateQueue, postReplyQueue]) {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      return {
        id:       job.id,
        queue:    queue.name,
        state,
        progress: job.progress,
        data:     job.data,
        result:   job.returnvalue,
        failedReason: job.failedReason,
        processedOn:  job.processedOn,
        finishedOn:   job.finishedOn,
      };
    }
  }
  return null;
}


logger.info('BullMQ queues initialised: classify | generate | post-reply');
