import { connectdb, disconnectdb } from './config/db.js';
import User from './models/User.models.js';
import { youtubeSyncQueue } from './tasks/scheduler.js';
import logger from './utils/logger.js';

async function runTest() {
    try {
        await connectdb();
        logger.info('Connected to DB. Finding users to sync...');

        const users = await User.find({ 
            refreshToken: { $ne: null, $exists: true }, 
            channelId: { $ne: null, $exists: true } 
        });

        if (users.length === 0) {
            logger.warn('No users found with both a refreshToken and channelId connected. Cannot test!');
        } else {
            logger.info(`Found ${users.length} user(s). Manually queueing sync jobs bypassing the 24h timer...`);
            for (const user of users) {
                await youtubeSyncQueue.add('sync-channel', {
                    userId: user._id.toString(),
                    channelId: user.channelId
                });
                logger.info(`🚀 Instantly sent job to BullMQ for User: ${user._id} (Channel: ${user.channelId})`);
            }
            logger.info('Jobs dispatched! Watch your main worker terminal (nodemon) to see the logs.');
        }

    } catch (err) {
        logger.error('Error in test script:', err.message);
    } finally {
        setTimeout(async () => {
            await disconnectdb();
            process.exit(0);
        }, 1000); // 1 sec delay to ensure jobs flush to Redis
    }
}

runTest();
