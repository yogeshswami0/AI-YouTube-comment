import cron from "node-cron";
import Channel from "../models/Channel.models.js";
import Video from "../models/Video.models.js";
import { getValidYoutubeToken } from "../utils/youtubeToken.helper.js";
import { getVideoCommentsInfo } from "../services/Channel.service.js";
import logger from "../utils/logger.js";

// Utility function to sync all comments across all channels globally
const syncAllChannelsGlobally = async () => {
    logger.info("[Cron] Starting Global YouTube Comments Sync...");
    
    try {
        const channels = await Channel.find({}).lean();
        if (!channels || channels.length === 0) {
            logger.info("[Cron] No channels registered yet. Skipping sync.");
            return;
        }

        for (const channel of channels) {
            logger.debug(`[Cron] Syncing channel: ${channel.title || channel.channelId}`);
            
            let accessToken;
            try {
                // Fetch fresh token using our unified resilient helper
                accessToken = await getValidYoutubeToken(channel.userId.toString());
            } catch (authErr) {
                logger.error(`[Cron] Skipping channel ${channel.channelId} due to auth failure: ${authErr.message}`);
                continue; // Move to the next user's channel if this one fails to auth
            }

            // Find all videos for this specific channel
            const videos = await Video.find({ channelId: channel.channelId }).lean();
            if(!videos || videos.length === 0) continue;

            const BATCH_SIZE = 5; // Process 5 videos concurrently so we don't totally smash the API or RAM
            
            for (let i = 0; i < videos.length; i += BATCH_SIZE) {
                const batch = videos.slice(i, i + BATCH_SIZE);
                
                // Map over batch and call getVideoCommentsInfo (our core youtube fetching service)
                const promises = batch.map(async (v) => {
                    try {
                        logger.debug(`[Cron] Fetching comments for video ${v.videoId}`);
                        // fetchAll is set to false by default inside getVideoCommentsInfo, 
                        // so it just grabs the latest page (top 100 comments), preserving quota!
                        await getVideoCommentsInfo(accessToken, v.videoId);
                    } catch (syncErr) {
                        logger.error(`[Cron] Failed fetching comments on video ${v.videoId}: ${syncErr.message}`);
                    }
                });

                await Promise.all(promises);
            }
        }

        logger.info("[Cron] Global YouTube Comments Sync Completed Successfully!");

    } catch (globalErr) {
        logger.error("[Cron] Global Sync encountered a fatal crash:", globalErr);
    }
};

let isSyncRunning = false;

// Start the Cron Job to run every 30 minutes!
// Pattern: "*/30 * * * *" means exactly every 30 minutes, 24/7.
const startSyncCronJob = () => {
    const task = cron.schedule("*/30 * * * *", async () => {
        if (isSyncRunning) {
            logger.warn("[Cron] Skipping scheduled run: previous sync still in progress.");
            return;
        }
        isSyncRunning = true;
        try {
            await syncAllChannelsGlobally();
        } finally {
            isSyncRunning = false;
        }
    });
    logger.info("Cron Job Initialized: Synchronizing YouTube Comments every 30 minutes.");
    return task;
};

export default startSyncCronJob;
