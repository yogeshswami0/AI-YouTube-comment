import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import logger from './logger.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail:    { count: 500 },
};

// Queue instance used by workers to enqueue downstream jobs
const generateQueue = new Queue('generate', {
  connection: bullConnection,
  prefix: env.REDIS_BULL_PREFIX,
  defaultJobOptions,
});

export const enqueueGenerateJob = async (data, opts = {}) => {
  const job = await generateQueue.add('generate', data, opts);
  logger.info(`Enqueued generate job ${job.id} for comment ${data.commentId}`);
  return job;
};
