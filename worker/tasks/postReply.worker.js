import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../config/redis.js';
import Reply from '../models/Reply.models.js';
import Comment from '../models/Comment.models.js';
import Video from '../models/Video.models.js';
import { getValidYoutubeToken } from '../utils/youtubeToken.helper.js';
import { buildYoutubeClient } from '../utils/youtubeClient.js';
import logger from '../utils/logger.js';

export const postReplyWorker = new Worker(
  'post-reply',
  async (job) => {
    const { replyId } = job.data;

    let youtubePostSucceeded = false;
    try {
      // 1. Atomically "claim" the reply by setting its status to 'publishing'
      // This prevents other workers from picking up the same reply simultaneously
      // Note: We allow 'publishing' status here to support retries in an idempotent way
      const reply = await Reply.findOneAndUpdate(
        { _id: replyId, status: { $ne: 'published' } },
        { $set: { status: 'publishing' } },
        { returnDocument: 'after' }
      );

      if (!reply) {
        logger.warn(`PostReply Job ${job.id}: Reply ${replyId} not found, already being published, or already published.`);
        return { success: true, status: 'already_handled' };
      }

      // Ensure we have final text to post
      const textToPost = reply.finalText || reply.editedText || reply.generatedText;
      if (!textToPost) {
          // If we claimed it but it has no text, mark it failed and throw
          reply.status = 'failed';
          await reply.save();
          throw new Error(`Reply ${replyId} has no text to post`);
      }

      // 2. Fetch the Comment to get the video ID
      const comment = await Comment.findById(reply.commentId);
      if (!comment) {
          throw new Error('Associated comment not found');
      }

      // 3. Fetch the Video to get the owner (userId)
      const video = await Video.findOne({ videoId: comment.videoId });
      if (!video) {
          throw new Error(`Video ${comment.videoId} not found`);
      }

      // 4. Fetch the valid YouTube Access Token for the user
      const accessToken = await getValidYoutubeToken(video.userId.toString());
      
      // 5. Build the YouTube Client and post the comment
      const youtube = buildYoutubeClient(accessToken);
      
      let ytReplyId = reply.ytReplyId;

      if (ytReplyId) {
          logger.info(`PostReply Job ${job.id}: Reply ${replyId} already posted to YouTube (ID: ${ytReplyId}). Skipping insert.`);
          youtubePostSucceeded = true;
      } else {
          // Post the comment to YouTube
          const response = await youtube.comments.insert({
              part: ['snippet'],
              requestBody: {
                  snippet: {
                      parentId: comment.ytCommentId,
                      textOriginal: textToPost
                  }
              }
          });

          youtubePostSucceeded = true; 
          ytReplyId = response.data.id;

          // Checkpoint: Save the ytReplyId immediately so retries know it worked
          reply.ytReplyId = ytReplyId;
          await reply.save();
      }

      // 6. Update the Reply document to 'published'
      reply.ytReplyId = ytReplyId;
      reply.status = 'published';
      reply.publishedAt = new Date();
      await reply.save();

      // 7. Increment comment.replyCount at most once per reply (retries must not double-count)
      const claimResult = await Reply.updateOne(
        { _id: replyId, replyCountCredited: { $ne: true } },
        { $set: { replyCountCredited: true } }
      );
      if (claimResult.modifiedCount > 0) {
        try {
          await Comment.findByIdAndUpdate(comment._id, { $inc: { replyCount: 1 } });
        } catch (incErr) {
          await Reply.updateOne({ _id: replyId }, { $set: { replyCountCredited: false } });
          throw incErr;
        }
      }

      logger.info(`PostReply Job ${job.id} completed. Posted reply to ${comment.ytCommentId}`);
      return { success: true, ytReplyId };

    } catch (error) {
      logger.error(`PostReply Job ${job.id} failed:`, error.message);
      
      // If the post to YouTube failed, mark it as 'failed' in DB 
      // If the post succeeded (either in this attempt or a previous one), we DON'T mark it failed 
      // to avoid triggering redundant retries that might lead to confusion.
      if (replyId && !youtubePostSucceeded) {
          // Double check the DB to ensure no ytReplyId was recorded by a parallel or previous partially-failed attempt
          const latestReply = await Reply.findById(replyId);
          if (latestReply && !latestReply.ytReplyId) {
              await Reply.findOneAndUpdate(
                  { _id: replyId, status: 'publishing' },
                  { $set: { status: 'failed' } }
              ).catch(err => {
                  logger.error(`Failed to update reply ${replyId} status to failed: ${err.message}`);
              });
          } else if (latestReply && latestReply.ytReplyId) {
              logger.warn(`PostReply Job ${job.id}: Post succeeded (found ytReplyId ${latestReply.ytReplyId}) despite catch block trigger. Not marking as failed.`);
          }
      } else if (youtubePostSucceeded) {
          logger.warn(`PostReply Job ${job.id}: Post succeeded but subsequent logic failed. Manual intervention may be needed to mark reply ${replyId} as published.`);
      }
      
      throw error; // Let BullMQ retry
    }
  },
  {
    connection: bullConnection,
    prefix: env.REDIS_BULL_PREFIX,
    concurrency: 5,
  }
);
