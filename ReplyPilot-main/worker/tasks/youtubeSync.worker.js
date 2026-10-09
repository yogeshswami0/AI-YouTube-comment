import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis.js';
import redis, { keys } from '../config/redis.js';
import { getValidYoutubeToken } from '../utils/youtubeToken.helper.js';
import { buildYoutubeClient, fetchLatestVideos, fetchTranscript } from '../utils/youtubeClient.js';
import Video from '../models/Video.models.js';
import logger from '../utils/logger.js';
import axios from 'axios';
import { env } from '../config/env.js';

const youtubeSyncWorker = new Worker(
  'youtube-sync-queue',
  async (job) => {
    const { userId, channelId } = job.data;
    logger.info(`Starting YouTube sync for user ${userId}, channel ${channelId}`);

    try {
      const accessToken = await getValidYoutubeToken(userId);
      const youtubeClient = buildYoutubeClient(accessToken);

      // Fetch the latest videos without a specific date constraint
      const videos = await fetchLatestVideos(youtubeClient, channelId);

      logger.info(`Found ${videos.length} recent videos for channel ${channelId}`);

      for (const item of videos) {
        // search.list returns id: { videoId: "..." } for videos
        const videoId = item.id?.videoId;
        if (!videoId) {
           logger.debug('Item has no videoId, skipping', { item: JSON.stringify(item.id) });
           continue; 
        }

        // Upsert video to DB
        logger.debug(`Upserting video ${videoId} to DB for channel ${channelId}`);
        await Video.findOneAndUpdate(
          { videoId: videoId },
          {
            videoId: videoId,
            channelId: channelId,
            userId: userId,
            title: item.snippet?.title,
            description: item.snippet?.description,
            publishedAt: new Date(item.snippet?.publishedAt),
            thumbnail: {
              default: item.snippet?.thumbnails?.default?.url,
              medium: item.snippet?.thumbnails?.medium?.url,
              high: item.snippet?.thumbnails?.high?.url
            },
            lastSyncedAt: new Date()
          },
          { upsert: true, new: true }
        );
        logger.debug(`Successfully upserted video ${videoId}`);

        // Check if video is already indexed in Pinecone via RAG service
        let isIndexedInRAG = false;
        try {
          const statusRes = await axios.get(`${env.RAG_SERVICE_URL}/api/v1/ingest/status/${videoId}`);
          if (statusRes.data && statusRes.data.indexed) {
             isIndexedInRAG = true;
          }
        } catch (statusError) {
          logger.warn(`Could not verify RAG index status for video ${videoId}: ${statusError.message}`);
        }

        if (isIndexedInRAG) {
          logger.debug(`Video ${videoId} is already indexed in Pinecone (RAG), skipping transcript fetch.`);
          continue;
        }

        let hasTranscript = false;

        // Fetch and cache transcript if not already in Redis
        const existingTranscript = await redis.get(keys.ytTranscript(videoId));
        if (existingTranscript) {
          logger.debug(`Transcript for video ${videoId} already exists in Redis, skipping fetch.`);
          hasTranscript = true;
        } else {
          const transcriptText = await fetchTranscript(videoId);
          if (transcriptText) {
            await redis.set(keys.ytTranscript(videoId), transcriptText, { EX: 86400 });
            logger.debug(`Cached new transcript for video ${videoId}`);
            hasTranscript = true;
          } else {
            logger.warn(`No transcript found or error fetching for video ${videoId}`);
          }
        }

        if (hasTranscript) {
          // Trigger RAG ingestion
          try {
            logger.info(`Triggering RAG ingestion for video ${videoId}`);
            await axios.post(`${env.RAG_SERVICE_URL}/api/v1/ingest`, {
              video_id: videoId,
              video_title: item.snippet?.title || null,
              channel_name: item.snippet?.channelTitle || null,
              chunk_window_seconds: 60,
              force_reindex: true
            });
            logger.debug(`Successfully triggered RAG ingestion for video ${videoId}`);
          } catch (ragError) {
            logger.error(`Failed to trigger RAG ingestion for video ${videoId}: ${ragError.message}`);
          }
        }
      }

      logger.info(`Successfully synced channel ${channelId}`);
      return { success: true, videosSynced: videos.length };
    } catch (error) {
      // Gracefully handle all auth-related failures — these are expected when
      // users haven't verified their app, revoked access, or tokens expired.
      const msg = error.message || '';
      if (error.reAuthNeeded || msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
        logger.warn(`User ${userId} needs to re-authenticate for channel ${channelId}. Skipping sync. (${msg})`);
        return { success: false, reason: "reAuthNeeded" };
      }
      logger.error(`Error in youtube sync worker for channel ${channelId}: ${msg}`, { errorStack: error.stack });
      throw error;
    }
  },
  { connection: bullConnection }
);

youtubeSyncWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} for youtube sync has completed!`);
});

youtubeSyncWorker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} for youtube sync has failed with ${err.message}`);
});

export default youtubeSyncWorker;
