import Comment from '../models/Comment.models.js';
import Reply from '../models/Reply.models.js';
import Video from '../models/Video.models.js';
import Persona from '../models/Persona.models.js';
import VideoExample from '../models/VideoExample.models.js';
import { generateReply } from '../services/replyService.js';
import { enqueueGenerateJob, enqueuePostReplyJob } from '../services/queue.service.js';
import logger from '../utils/logger.js';
import axios from 'axios';
import { env } from '../config/env.js';

const VALID_TONES = [
  'friendly', 'professional', 'humorous', 'promotional',
  'appreciative', 'informative', 'supportive', 'apologetic', 'neutral',
  'romantic', 'rude', 'crazy',
];

async function fetchFewShotExamples(videoId, tone, intents = [], limit = 4) {
  if (!videoId || !tone || !intents.length) return [];
  try {
    const scoresMap = { question: 0, praise: 0, critism: 0, neutral: 0, spam: 0 };
    for (const intent of intents) {
      const label = intent.label?.toLowerCase();
      if (label === 'criticism') scoresMap.critism = intent.confidence;
      else if (scoresMap[label] !== undefined) scoresMap[label] = intent.confidence;
    }
    const scoresArray = [scoresMap.question, scoresMap.praise, scoresMap.critism, scoresMap.neutral, scoresMap.spam];
    if (scoresArray.every(s => s === 0)) return [];

    // Cosine similarity aggregation directly against VideoExample, scoped by tone
    const results = await VideoExample.aggregate([
      {
        $match: {
          videoId,
          tone,
          $or: [
            { 'scores.question': { $gt: 0 } },
            { 'scores.praise': { $gt: 0 } },
            { 'scores.critism': { $gt: 0 } },
            { 'scores.neutral': { $gt: 0 } },
            { 'scores.spam': { $gt: 0 } },
          ],
        },
      },
      {
        $addFields: {
          similarity: {
            $let: {
              vars: {
                q: scoresArray,
                d: [
                  '$scores.question',
                  '$scores.praise',
                  '$scores.critism',
                  '$scores.neutral',
                  '$scores.spam',
                ],
              },
              in: {
                $divide: [
                  {
                    $sum: {
                      $map: {
                        input: { $range: [0, 5] },
                        as: 'i',
                        in: {
                          $multiply: [
                            { $arrayElemAt: ['$$q', '$$i'] },
                            { $arrayElemAt: ['$$d', '$$i'] },
                          ],
                        },
                      },
                    },
                  },
                  {
                    $max: [
                      {
                        $multiply: [
                          {
                            $sqrt: {
                              $sum: {
                                $map: {
                                  input: '$$q',
                                  as: 'x',
                                  in: { $multiply: ['$$x', '$$x'] },
                                },
                              },
                            },
                          },
                          {
                            $sqrt: {
                              $sum: {
                                $map: {
                                  input: '$$d',
                                  as: 'x',
                                  in: { $multiply: ['$$x', '$$x'] },
                                },
                              },
                            },
                          },
                        ],
                      },
                      0.0001, // Avoid division by zero
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      { $match: { similarity: { $gte: 0.25 } } },
      { $sort: { similarity: -1 } },
      { $limit: limit },
    ]);

    return results.map(r => ({
      comment_text: r.commentText,
      reply_text: r.replyText,
    }));
  } catch (err) {
    logger.error(`Failed to fetch few-shot examples for video ${videoId}:`, err.message);
    return [];
  }
}

// ─── Generate a reply for a single comment ──────────────────────────────────

export async function generateSingleReply(req, res, next) {
  try {
    const { id } = req.params;
    const { tone = 'friendly', personaId, force = false } = req.body || {};

    if (!VALID_TONES.includes(tone)) {
      return res.status(400).json({ error: `tone must be one of: ${VALID_TONES.join(', ')}` });
    }

    let comment = await Comment.findById(id).lean();
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // 2. Auto-Classify if not done
    if (comment.classificationStatus !== 'done' || force) {
      try {
        const AI_SERVICE_URL = env.AI_SERVICE_URL || 'http://localhost:8000';
        const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/v1/classify`, {
          comment_id: id,
          text: comment.textDisplay || comment.text,
          video_id: comment.videoId
        });

        const { intents = [], is_spam = false, language = null, is_english = true } = aiResponse.data;
        const normalizedIntents = (intents || [])
          .filter(i => ['question', 'praise', 'criticism', 'spam', 'neutral'].includes(i.label?.toLowerCase()))
          .map(i => ({ label: i.label.toLowerCase(), confidence: i.confidence }));

        comment = await Comment.findByIdAndUpdate(
          id,
          { 
            intents: normalizedIntents,
            isSpam: is_spam,
            classificationStatus: 'done',
            language,
            isEnglish: is_english
          },
          { returnDocument: 'after' }
        ).lean();
      } catch (err) {
        logger.error(`Auto-classification failed for comment ${id}: ${err.message}`);
        return res.status(500).json({ error: 'Classification failed prior to generation.' });
      }
    }

    if (comment.isSpam && !force) {
      return res.status(400).json({ error: 'Spam detected. Auto-generation blocked unless forced.' });
    }

    // 3. Build video context
    let videoContext = '';
    const video = await Video.findOne({ videoId: comment.videoId }).lean();
    if (video) {
        videoContext = `Title: ${video.title || 'N/A'}. Description: ${(video.description || '').slice(0, 500)}`;
    }

    // 4. Fetch persona details
    let creatorBio = null;
    let effectivePersonaId = personaId;
    if (!effectivePersonaId && video) {
        const defaultPersona = await Persona.findOne({ userId: video.userId, isDefault: true }).lean();
        if (defaultPersona) effectivePersonaId = defaultPersona._id;
    }
    if (effectivePersonaId) {
        const persona = await Persona.findById(effectivePersonaId).lean();
        if (persona) creatorBio = persona.creatorBio || persona.description || null;
    }

    // 5. Fetch few-shot examples (video-scoped)
    const fewShotExamples = await fetchFewShotExamples(comment.videoId, tone, comment.intents);

    // 6. Call the FastAPI generate endpoint with enriched payload
    const aiResult = await generateReply({
      commentId: id,
      commentText: comment.textDisplay || comment.text,
      tone,
      personaId: effectivePersonaId,
      videoContext,
      videoId: comment.videoId,
      intents: comment.intents,
      isEnglish: comment.isEnglish,
      creatorBio,
      fewShotExamples: fewShotExamples.length > 0 ? fewShotExamples : null
    });

    if (aiResult.reply_text === '[SPAM_DETECTED]') {
        await Comment.findByIdAndUpdate(id, { isSpam: true });
        return res.status(400).json({ error: 'Non-English spam detected by generation guard.' });
    }

    // 7. Save to MongoDB Reply collection
    const reply = await Reply.findOneAndUpdate(
      { commentId: id },
      {
        commentId: id,
        ytCommentId: comment.ytCommentId,
        personaId: effectivePersonaId || undefined,
        generatedText: aiResult.reply_text,
        tone: aiResult.tone || tone,
        status: 'pending_review',
      },
      { upsert: true, returnDocument: 'after' }
    );

    logger.info(`Reply generated for comment ${id} (tone: ${tone})`);

    return res.status(201).json({
      message: 'Reply generated successfully',
      data: reply,
    });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') return res.status(503).json({ error: 'AI Service is offline' });
    next(err);
  }
}

// ─── List all replies for a video ───────────────────────────────────────────

export async function listReplies(req, res, next) {
  try {
    const {
      videoId,
      status,
      page = '1',
      limit = '20',
    } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId query param is required' });
    }

    // Get all comment IDs for this video
    const commentIds = await Comment.find({ videoId }).distinct('_id');

    const filter = { commentId: { $in: commentIds } };
    if (status) filter.status = status;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Reply.find(filter)
        .populate('commentId', 'text textDisplay authorName intent')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Reply.countDocuments(filter),
    ]);

    return res.json({
      items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Get a single reply by comment ID ───────────────────────────────────────

export async function getReply(req, res, next) {
  try {
    const reply = await Reply.findOne({ commentId: req.params.id })
      .populate('commentId', 'text textDisplay authorName intent')
      .lean();
    if (!reply) return res.status(404).json({ error: 'Reply not found for this comment' });
    return res.json({ data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Edit a generated reply before publishing ───────────────────────────────

export async function editReply(req, res, next) {
  try {
    const { editedText } = req.body;
    if (!editedText || !editedText.trim()) {
      return res.status(400).json({ error: 'editedText is required' });
    }

    const reply = await Reply.findById(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });

    reply.editedText = editedText.trim();
    reply.finalText = editedText.trim();
    await reply.save();

    return res.json({ message: 'Reply updated', data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Approve a reply (marks it ready for publishing) ────────────────────────

export async function approveReply(req, res, next) {
  try {
    const reply = await Reply.findById(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });

    reply.status = 'approved';
    if (!reply.finalText) {
      reply.finalText = reply.editedText || reply.generatedText;
    }
    await reply.save();

    return res.json({ message: 'Reply approved', data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Reject a reply ─────────────────────────────────────────────────────────

export async function rejectReply(req, res, next) {
  try {
    const reply = await Reply.findByIdAndUpdate(
      req.params.replyId,
      { status: 'rejected' },
      { returnDocument: 'after' }
    );
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    return res.json({ message: 'Reply rejected', data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Publish a reply ────────────────────────────────────────────────────────

export async function publishReply(req, res, next) {
  try {
    const reply = await Reply.findById(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });

    reply.status = 'publishing';
    if (!reply.finalText) {
      reply.finalText = reply.editedText || reply.generatedText;
    }
    await reply.save();

    const comment = await Comment.findById(reply.commentId).lean();
    if (comment) {
      const scores = { question: 0, praise: 0, critism: 0, neutral: 0, spam: 0 };
      (comment.intents || []).forEach(intent => {
        if (intent.label === 'criticism') scores.critism = intent.confidence;
        else if (scores[intent.label] !== undefined) scores[intent.label] = intent.confidence;
      });

      const textToSave = comment.textDisplay || comment.text;
      const exampleTone = reply.tone || 'friendly';
      if (textToSave) {
        await VideoExample.findOneAndUpdate(
          { videoId: comment.videoId, tone: exampleTone, commentText: textToSave, replyText: reply.finalText },
          {
            videoId: comment.videoId,
            tone: exampleTone,
            commentText: textToSave,
            replyText: reply.finalText,
            scores
          },
          { upsert: true, returnDocument: 'after' }
        );
      }
    }

    await enqueuePostReplyJob({ replyId: reply._id.toString() });

    return res.json({ message: 'Reply queued for publishing', data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Batch Publish replies ──────────────────────────────────────────────────

export async function publishBatch(req, res, next) {
  try {
    const { replyIds } = req.body;
    if (!Array.isArray(replyIds) || replyIds.length === 0) {
      return res.status(400).json({ error: 'replyIds array is required' });
    }

    const replies = await Reply.find({ _id: { $in: replyIds } });
    
    const results = [];
    for (const reply of replies) {
      if (['published', 'publishing'].includes(reply.status)) continue;

      reply.status = 'publishing';
      if (!reply.finalText) {
         reply.finalText = reply.editedText || reply.generatedText;
      }
      await reply.save();
      
      const comment = await Comment.findById(reply.commentId).lean();
      if (comment) {
        const scores = { question: 0, praise: 0, critism: 0, neutral: 0, spam: 0 };
        (comment.intents || []).forEach(intent => {
          if (intent.label === 'criticism') scores.critism = intent.confidence;
          else if (scores[intent.label] !== undefined) scores[intent.label] = intent.confidence;
        });
        const textToSave = comment.textDisplay || comment.text;
        const exampleTone = reply.tone || 'friendly';
        if (textToSave) {
          await VideoExample.findOneAndUpdate(
            { videoId: comment.videoId, tone: exampleTone, commentText: textToSave, replyText: reply.finalText },
            { videoId: comment.videoId, tone: exampleTone, commentText: textToSave, replyText: reply.finalText, scores },
            { upsert: true, returnDocument: 'after' }
          );
        }
      }

      await enqueuePostReplyJob({ replyId: reply._id.toString() });
      results.push(reply._id);
    }

    return res.json({ message: `${results.length} replies queued for publishing`, queued: results.length });
  } catch (err) {
    next(err);
  }
}

// ─── Create a manual reply ──────────────────────────────────────────────────

export async function createManualReply(req, res, next) {
  try {
    const { commentId } = req.params;
    const { text, personaId } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const comment = await Comment.findById(commentId).lean();
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.classificationStatus !== 'done') {
      return res.status(400).json({ error: 'Comment must be classified before creating a reply' });
    }

    const reply = await Reply.findOneAndUpdate(
      { commentId },
      {
        commentId,
        ytCommentId: comment.ytCommentId,
        personaId: personaId || undefined,
        editedText: text.trim(),
        finalText: text.trim(),
        status: 'pending_review',
      },
      { upsert: true, returnDocument: 'after' }
    );

    const scores = { question: 0, praise: 0, critism: 0, neutral: 0, spam: 0 };
    (comment.intents || []).forEach(intent => {
      if (intent.label === 'criticism') scores.critism = intent.confidence;
      else if (scores[intent.label] !== undefined) scores[intent.label] = intent.confidence;
    });

    const textToSave = comment.textDisplay || comment.text;
    const exampleTone = 'friendly';
    if (textToSave) {
      await VideoExample.findOneAndUpdate(
        { videoId: comment.videoId, tone: exampleTone, commentText: textToSave, replyText: text.trim() },
        { videoId: comment.videoId, tone: exampleTone, commentText: textToSave, replyText: text.trim(), scores },
        { upsert: true, returnDocument: 'after' }
      );
    }

    logger.info(`Manual reply created for comment ${commentId}`);

    return res.status(201).json({ message: 'Manual reply created', data: reply });
  } catch (err) {
    next(err);
  }
}

// ─── Regenerate: create a new reply for the same comment ────────────────────

export async function regenerateReply(req, res, next) {
  try {
    const reply = await Reply.findById(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });

    const { tone = reply.tone } = req.body || {};

    let comment = await Comment.findById(reply.commentId).lean();
    if (!comment) return res.status(404).json({ error: 'Original comment not found' });

    // Auto-Classify if not done
    if (comment.classificationStatus !== 'done') {
      try {
        const AI_SERVICE_URL = env.AI_SERVICE_URL || 'http://localhost:8000';
        const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/v1/classify`, {
          comment_id: comment._id.toString(),
          text: comment.textDisplay || comment.text,
          video_id: comment.videoId
        });
        const { intents = [], is_spam = false, language = null, is_english = true } = aiResponse.data;
        const normalizedIntents = (intents || [])
          .filter(i => ['question', 'praise', 'criticism', 'spam', 'neutral'].includes(i.label?.toLowerCase()))
          .map(i => ({ label: i.label.toLowerCase(), confidence: i.confidence }));
        comment = await Comment.findByIdAndUpdate(
          comment._id,
          { 
            intents: normalizedIntents,
            isSpam: is_spam,
            classificationStatus: 'done',
            language,
            isEnglish: is_english
          },
          { returnDocument: 'after' }
        ).lean();
      } catch (err) {
        logger.error(`Auto-classification failed for comment ${comment._id}: ${err.message}`);
        return res.status(500).json({ error: 'Classification failed prior to generation.' });
      }
    }

    if (comment.isSpam) {
      return res.status(400).json({ error: 'Spam detected. Regeneration blocked.' });
    }

    let videoContext = '';
    const video = await Video.findOne({ videoId: comment.videoId }).lean();
    if (video) {
      videoContext = `Title: ${video.title || 'N/A'}. Description: ${(video.description || '').slice(0, 500)}`;
    }

    let creatorBio = null;
    let effectivePersonaId = reply.personaId;
    if (!effectivePersonaId && video) {
        const defaultPersona = await Persona.findOne({ userId: video.userId, isDefault: true }).lean();
        if (defaultPersona) effectivePersonaId = defaultPersona._id;
    }
    if (effectivePersonaId) {
        const persona = await Persona.findById(effectivePersonaId).lean();
        if (persona) creatorBio = persona.creatorBio || persona.description || null;
    }

    const fewShotExamples = await fetchFewShotExamples(comment.videoId, tone, comment.intents);

    const aiResult = await generateReply({
      commentId: reply.commentId.toString(),
      commentText: comment.textDisplay || comment.text,
      tone,
      personaId: effectivePersonaId?.toString() || null,
      videoContext,
      videoId: comment.videoId,
      intents: comment.intents,
      isEnglish: comment.isEnglish,
      creatorBio,
      fewShotExamples: fewShotExamples.length > 0 ? fewShotExamples : null
    });

    if (aiResult.reply_text === '[SPAM_DETECTED]') {
        await Comment.findByIdAndUpdate(comment._id, { isSpam: true });
        return res.status(400).json({ error: 'Non-English spam detected by generation guard.' });
    }

    reply.generatedText = aiResult.reply_text;
    reply.personaId = effectivePersonaId;
    reply.editedText = undefined;
    reply.finalText = aiResult.reply_text;
    reply.tone = aiResult.tone || tone;
    reply.status = 'pending_review';
    await reply.save();

    logger.info(`Reply regenerated for comment ${reply.commentId} (tone: ${tone})`);
    return res.json({ message: 'Reply regenerated', data: reply });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') return res.status(503).json({ error: 'AI Service is offline' });
    next(err);
  }
}

// ─── Delete a generated reply ───────────────────────────────────────────────

export async function deleteReply(req, res, next) {
  try {
    const reply = await Reply.findByIdAndDelete(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });
    return res.json({ message: 'Reply deleted successfully', data: reply });
  } catch (err) {
    next(err);
  }
}
