import Comment from '../models/Comment.models.js';
import Video from '../models/Video.models.js';
import Persona from '../models/Persona.models.js';
import { enqueueClassifyBulk, getJobStatus } from '../services/queue.service.js';
import logger from '../utils/logger.js';

const ENQUEUE_CHUNK = 200;

export async function enqueueBatch(req, res, next) {
  try {
    const userId = req.user._id;
    let { videoId, commentIds, tone = 'friendly', personaId } = req.body;

    if (!videoId) return res.status(400).json({ error: 'videoId is required' });

    if (!personaId) {
      const defaultPersona = await Persona.findOne({ userId, isDefault: true }).lean();
      if (defaultPersona) {
        personaId = defaultPersona._id.toString();
      }
    }

    const video = await Video.findOne({ videoId, userId }).lean();
    if (!video) {
      return res
        .status(403)
        .json({ error: 'Video not found or does not belong to you' });
    }

    const pendingFilter = { videoId, classificationStatus: 'pending' };
    if (commentIds?.length) pendingFilter._id = { $in: commentIds };

    const toClaim = await Comment.find(pendingFilter).select('_id').lean();

    if (toClaim.length === 0) {
      return res.json({ message: 'No pending comments to process', queued: 0 });
    }

    const claimIds = toClaim.map((c) => c._id);

    await Comment.updateMany(
      { _id: { $in: claimIds }, classificationStatus: 'pending' },
      { $set: { classificationStatus: 'processing' } },
    );

    const claimed = await Comment.find({
      _id: { $in: claimIds },
      classificationStatus: 'processing',
    })
      .select('_id ytCommentId text')
      .lean();

    try {
      for (let i = 0; i < claimed.length; i += ENQUEUE_CHUNK) {
        const chunk = claimed.slice(i, i + ENQUEUE_CHUNK);
        const jobs = chunk.map((c) => ({
          name: 'classify',
          data: {
            commentId: c._id.toString(),
            commentText: c.text,
            videoId,
            tone,
            personaId: personaId || null,
          },
          opts: { jobId: `classify-${c._id.toString()}` },
        }));
        await enqueueClassifyBulk(jobs);
      }
    } catch (enqueueErr) {
      await Comment.updateMany(
        { _id: { $in: claimed.map((c) => c._id) } },
        { $set: { classificationStatus: 'pending' } },
      );
      logger.error(
        `Batch enqueue failed for video ${videoId}, rolled back ${claimed.length} comments`,
        enqueueErr,
      );
      throw enqueueErr;
    }

    logger.info(
      `Batch enqueued ${claimed.length} classify jobs for video ${videoId}`,
    );

    return res.status(202).json({
      message: `${claimed.length} comments queued for processing`,
      queued: claimed.length,
    });
  } catch (err) {
    next(err);
  }
}

export async function getBatchStatus(req, res, next) {
  try {
    const status = await getJobStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: 'Job not found' });
    return res.json({ data: status });
  } catch (err) {
    next(err);
  }
}