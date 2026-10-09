import { Queue, Worker } from 'bullmq';
import { bullConnection } from '../config/redis.js';
import User from '../models/User.models.js';
import logger from '../utils/logger.js';

// The queue where we execute the specific channel sync
export const youtubeSyncQueue = new Queue('youtube-sync-queue', { connection: bullConnection });

// The queue specifically for the master dispatcher
const dailySchedulerQueue = new Queue('daily-scheduler-queue', { connection: bullConnection });

// The worker that intercepts the daily trigger and distributes tasks to `youtube-sync-queue`
export const schedulerWorker = new Worker(
  'daily-scheduler-queue',
  async (job) => {
    logger.info('Running Daily YouTube Sync Dispatcher...');
    try {
      logger.debug('Querying database for users with YouTube channels...');
      // Find users who have both a refresh token and an associated channelId
      const users = await User.find({ 
        refreshToken: { $ne: null, $exists: true }, 
        channelId: { $ne: null, $exists: true } 
      });
      
      logger.info(`Found ${users.length} users with connected YouTube channels.`);

      for (const user of users) {
        logger.debug(`Adding sync job for userId: ${user._id}, channelId: ${user.channelId}`);
        await youtubeSyncQueue.add('sync-channel', {
          userId: user._id.toString(),
          channelId: user.channelId
        });
        logger.debug(`Successfully queued youtube sync for user ${user._id}`);
      }

      logger.debug('Daily YouTube Sync Dispatcher completed successfully.');
      return { dispatched: users.length };
    } catch (error) {
      logger.error(`Error dispatching daily youtube sync: ${error.message}`, { errorStack: error.stack });
      throw error;
    }
  },
  { connection: bullConnection }
);

schedulerWorker.on('failed', (job, err) => {
    logger.error(`[Worker scheduler] Job failed: ${err.message}`);
});

export async function initScheduler() {
  logger.info('Initializing Daily YouTube Scheduler (Cron 0 */2 * * *)');
  
  // Runs every 2 hours (0 */2 * * *)
  await dailySchedulerQueue.add(
    'dispatch-youtube-sync',
    {},
    {
      repeat: {
        pattern: '0 */2 * * *' 
      },
      jobId: 'master-daily-dispatcher'
    }
  );

  // Run immediately on application start
  logger.info('Triggering immediate initial sync run on startup...');
  await dailySchedulerQueue.add(
    'dispatch-youtube-sync',
    {},
    {
      jobId: `master-daily-dispatcher-startup-${Date.now()}` // Unique ID so it doesn't conflict
    }
  );
}
