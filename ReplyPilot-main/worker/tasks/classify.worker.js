import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../config/redis.js';
import Comment from '../models/Comment.models.js';
import httpClient from '../utils/httpClient.js';
import logger from '../utils/logger.js';
import { enqueueGenerateJob } from '../utils/queueHelpers.js';

export const classifyWorker = new Worker(
  'classify',
  async (job) => {
    const { commentId, tone, personaId, videoId } = job.data;

    try {
      // 1. Fetch the comment
      const comment = await Comment.findById(commentId);
      if (!comment) {
        throw new Error(`Comment not found for id: ${commentId}`);
      }

      // 2. Call AI Service for classification (now includes gatekeeper + lang detect)
      const aiResponse = await httpClient.post('/api/v1/classify', {
        comment_id: commentId,
        text: comment.textDisplay || comment.text,
        video_id: videoId || comment.videoId,
      });

      const {
        intents = [],
        is_spam = false,
        routing = 'discard',
        language = null,
        is_english = true,
      } = aiResponse.data;

      // 3. Update the comment with classification results
      comment.intents = intents.map(i => ({
        label: i.label?.toLowerCase(),
        confidence: i.confidence,
      }));
      comment.isSpam = is_spam;
      comment.classificationStatus = 'done';
      comment.language = language;
      comment.isEnglish = is_english;
      await comment.save();

      // 4. Chain to generate queue if routing says so
      if (routing === 'generate') {
        await enqueueGenerateJob(
          {
            commentId,
            tone: tone || 'friendly',
            personaId: personaId || null,
            videoId: videoId || comment.videoId,
            // Pass classification context to the generate worker
            language,
            isEnglish: is_english,
            intents: intents,
          },
          { jobId: `generate-${commentId}` }
        );
        logger.info(`Chained generate job for comment ${commentId} (routing=${routing}, lang=${language})`);
      } else if (routing === 'discard') {
        logger.info(`Skipping generate for spam comment ${commentId}`);
      } else if (routing === 'review') {
        logger.info(`Comment ${commentId} routed to review (criticism)`);
      }

      logger.info(`Classify Job ${job.id} completed for comment ${commentId}`);
      const primaryIntent = intents[0]?.label || 'neutral';
      return { success: true, intent: primaryIntent, isSpam: is_spam, routing, language };

    } catch (error) {
      logger.error(`Classify Job ${job.id} failed:`, error.message);
      
      // Attempt to mark comment as failed if it exists
      if (commentId) {
        await Comment.findByIdAndUpdate(commentId, { classificationStatus: 'failed' }).catch(err => {
            logger.error(`Failed to update comment ${commentId} status to failed: ${err.message}`);
        });
      }
      throw error; // Let BullMQ handle retries
    }
  },
  {
    connection: bullConnection,
    prefix: env.REDIS_BULL_PREFIX,
    concurrency: 5, // Process up to 5 jobs concurrently
  }
);
