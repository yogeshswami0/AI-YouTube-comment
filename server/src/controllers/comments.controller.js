import { env } from "../config/env.js";
import Comment from "../models/Comment.models.js";
import axios from "axios";


const VALID_INTENTS = ['question', 'praise', 'criticism', 'spam', 'neutral'];
const VALID_SORT    = ['publishedAt', 'likeCount'];

export const classifyComment = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Find the comment in MongoDB
    const comment = await Comment.findById(id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // 2. Call your FastAPI AI Service
    const aiResponse = await axios.post(`${env.AI_SERVICE_URL}/api/v1/classify`, {
      comment_id: id,
      text: comment.textDisplay || comment.text,
    });

    const { intents = [], is_spam = false, language = null, is_english = true } = aiResponse.data;

    // 3. Normalize intents array
    const normalizedIntents = (intents || [])
      .filter(i => VALID_INTENTS.includes(i.label?.toLowerCase()))
      .map(i => ({ label: i.label.toLowerCase(), confidence: i.confidence }));

    // 4. Update the database with the AI result
    const updatedComment = await Comment.findByIdAndUpdate(
      id,
      { 
        intents: normalizedIntents,
        isSpam: is_spam,
        classificationStatus: 'done',
        language,
        isEnglish: is_english
      },
      { returnDocument: 'after' }
    );

    return res.json({ 
      message: 'AI Classification complete', 
      data: updatedComment 
    });
  } catch (err) {
    // Handle AI Service being offline
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'AI Service (FastAPI) is offline' });
    }
    next(err);
  }
};

export const listComments = async (req,res,next)=>{
  try {
    const {
      videoId,
      intent,
      status,
      page   = '1',
      limit  = '20',
      sortBy = 'publishedAt',
      order  = 'desc',
    } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId query param is required' });
    }

    const filter = { videoId, replyCount: { $in: [0, null] } };
    if (intent && VALID_INTENTS.includes(intent)) {
      filter['intents.label'] = intent;
    }
    if (status) filter.classificationStatus = status;

    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip     = (pageNum - 1) * limitNum;
    const sortKey  = VALID_SORT.includes(sortBy) ? sortBy : 'publishedAt';
    const sortDir  = order === 'asc' ? 1 : -1;

    const basePipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'replies',
          localField: '_id',
          foreignField: 'commentId',
          as: 'replyData'
        }
      },
      {
        $match: {
          'replyData.status': { $nin: ['published', 'publishing'] }
        }
      }
    ];

    const [itemsResult, countResult] = await Promise.all([
      Comment.aggregate([
        ...basePipeline,
        { $sort: { [sortKey]: sortDir } },
        { $skip: skip },
        { $limit: limitNum },
        { $project: { replyData: 0 } }
      ]),
      Comment.aggregate([
        ...basePipeline,
        { $count: 'total' }
      ])
    ]);

    const items = itemsResult || [];
    const total = countResult[0]?.total || 0;

    return res.json({
      items,
      pagination: {
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getComment = async (req,res,next)=>{
  try {
    const comment = await Comment.findById(req.params.id).lean();
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    return res.json({ data: comment });
  } catch (err) {
    next(err);
  }
};

export const updateCommentIntent = async (req,res,next)=>{
  try {
    const { intents } = req.body;

    // Support both old single-intent format and new multi-intent format
    if (!intents || !Array.isArray(intents) || intents.length === 0) {
      return res.status(400).json({ error: 'intents must be an array of {label, confidence} objects' });
    }

    const valid = intents.every(i => VALID_INTENTS.includes(i.label) && typeof i.confidence === 'number');
    if (!valid) {
      return res.status(400).json({ error: `Each intent label must be one of: ${VALID_INTENTS.join(', ')} with a numeric confidence` });
    }

    const comment = await Comment.findByIdAndUpdate(
      req.params.id,
      { intents, classificationStatus: 'done' },
      { returnDocument: 'after' }
    );
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    return res.json({ data: comment });
  } catch (err) {
    next(err);
  }
};

// ─── Global search across videos & comments ─────────────────────────────────

export const searchAll = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ videos: [], comments: [] });

    const userId = req.user._id;
    const query = q.trim();
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const User = (await import('../models/User.models.js')).default;
    const user = await User.findById(req.user._id).select('channelId').lean();
    
    // If the user hasn't synced a channel yet, return empty
    if (!user || !user.channelId) {
      return res.json({ videos: [], comments: [] });
    }

    const { channelId } = user;
    const Video = (await import('../models/Video.models.js')).default;

    const [videos, comments] = await Promise.all([
      // Search only this user's videos via channelId
      Video.find({ channelId, title: regex })
        .select('videoId title thumbnail publishedAt viewCount commentCount')
        .sort({ publishedAt: -1 })
        .limit(5)
        .lean(),
      // Search comments only within this user's channel
      Comment.find({
        channelId,
        $or: [
          { text: regex },
          { textDisplay: regex },
          { authorName: regex },
        ]
      })
        .select('_id videoId text textDisplay authorName publishedAt')
        .sort({ publishedAt: -1 })
        .limit(5)
        .lean()
    ]);

    return res.json({ videos, comments });
  } catch (err) {
    next(err);
  }
};

