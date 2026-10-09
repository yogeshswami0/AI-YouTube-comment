import Channel from "../models/Channel.models.js";
import Video from "../models/Video.models.js";
import Comment from "../models/Comment.models.js";
import {
  getChannelInfo,
  getChannelVideosInfo,
  getVideoInfo,
  getVideoCommentsInfo
} from "../services/Channel.service.js";
import redis, { keys } from "../config/redis.js";
import logger from "../utils/logger.js";

const CHANNEL_CACHE_TTL = 60 * 10;   // 10 min
const VIDEO_CACHE_TTL   = 60 * 5;    // 5 min

export async function getChannelDetails(req, res, next) {
  try {
    const userId     = req.user._id.toString();
    const forceSync  = req.query.force === 'true';
    const cacheKey   = keys.channelCache(`user:${userId}`);

    if (!forceSync) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ source: 'cache', data: JSON.parse(cached) });
      }

      // Serve from DB if recently synced (< 10 min)
      const dbChannel = await Channel.findOne({ userId }).lean();
      if (dbChannel) {
        const staleSec = (Date.now() - new Date(dbChannel.lastSyncedAt)) / 1000;
        if (staleSec < CHANNEL_CACHE_TTL) {
          await redis.set(cacheKey, JSON.stringify(dbChannel),{EX:CHANNEL_CACHE_TTL});
          return res.json({ source: 'db', data: dbChannel });
        }
      }
    }

    const channel = await getChannelInfo(req.ytToken, req.user._id);

    await redis.set(cacheKey, JSON.stringify(channel),{EX:CHANNEL_CACHE_TTL});

    return res.json({ source: 'youtube', data: channel });
  } catch (err) {
    next(err);
  }
}

export async function getChannelVideos(req, res, next) {
  try {
    const userId     = req.user._id.toString();
    const {
      pageToken  = undefined,
      maxResults = '50',
      sync,
      fetchAll,
    } = req.query;

    const forceSync = sync === 'true';
    const bulkSync  = fetchAll === 'true';

    if (!forceSync && !pageToken && !bulkSync) {
      const channel  = await Channel.findOne({ userId }).lean();
      if (channel) {
        const dbVideos = await Video.find({ channelId: channel.channelId })
          .sort({ publishedAt: -1 })
          .limit(Number(maxResults))
          .lean();

        if (dbVideos.length) {
          return res.json({
            source: 'db',
            items:  dbVideos,
            totalResults: channel.videoCount,
            nextPageToken: null,
          });
        }
      }
    }

    const result = await getChannelVideosInfo(req.ytToken, req.user._id, {
      pageToken: pageToken || undefined,
      maxResults: Math.min(Number(maxResults), 50),
      fetchAll: bulkSync,
    });

    return res.json({ source: 'youtube', ...result });
  } catch (err) {
    next(err);
  }
}

export async function getVideoDetails(req, res, next) {
  try {
    const { videoId }  = req.params;
    const forceSync    = req.query.force === 'true';
    const cacheKey     = keys.videoCache(videoId);

    if (!forceSync) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ source: 'cache', data: JSON.parse(cached) });
      }

      const dbVideo = await Video.findOne({ videoId }).lean();
      if (dbVideo) {
        const staleSec = (Date.now() - new Date(dbVideo.lastSyncedAt)) / 1000;
        if (staleSec < VIDEO_CACHE_TTL) {
          await redis.set(cacheKey, JSON.stringify(dbVideo),{EX:VIDEO_CACHE_TTL});
          return res.json({ source: 'db', data: dbVideo });
        }
      }
    }

    const video = await getVideoInfo(req.ytToken, videoId, req.user._id);
    await redis.set(cacheKey, JSON.stringify(video),{EX:VIDEO_CACHE_TTL});

    return res.json({ source: 'youtube', data: video });
  } catch (err) {
    next(err);
  }
}

export async function getVideoComments(req, res, next) {
  try {
    const { videoId } = req.params;
    const {
      pageToken  = undefined,
      maxResults = '100',
      order      = 'relevance',
      intent,
      sync,
      fetchAll,
    } = req.query;

    const forceSync = sync === 'true';
    const bulkSync  = fetchAll === 'true';

    if (!forceSync && !pageToken && !bulkSync) {
      const filter = { videoId };
      if (intent) filter['intents.label'] = intent;

      const dbComments = await Comment.find(filter)
        .sort({ publishedAt: -1 })
        .limit(Number(maxResults))
        .lean();

      if (dbComments.length) {
        const total = await Comment.countDocuments({ videoId });
        return res.json({
          source:       'db',
          items:        dbComments,
          totalResults: total,
          nextPageToken: null,
        });
      }
    }

    const result = await getVideoCommentsInfo(req.ytToken, videoId, {
      pageToken: pageToken || undefined,
      maxResults: Math.min(Number(maxResults), 100),
      order,
      fetchAll: bulkSync,
    });

    logger.info(`Fetched ${result.items?.length ?? 0} comments for video ${videoId}`);

    return res.json({ source: 'youtube', ...result });
  } catch (err) {
    if (err?.response?.data?.error?.errors?.[0]?.reason === 'commentsDisabled') {
      return res.status(200).json({
        items: [],
        message: 'Comments are disabled for this video',
      });
    }
    next(err);
  }
}

export async function syncVideoComments(req, res, next) {
  try {
    const { videoId } = req.params;

    logger.info(`[Force Sync] Starting full comment sync for video ${videoId}`);

    const result = await getVideoCommentsInfo(req.ytToken, videoId, {
      fetchAll: true,
    });

    logger.info(`[Force Sync] Completed: ${result.totalSynced} comments synced for video ${videoId}`);

    return res.json({
      message: `Synced ${result.totalSynced} comments`,
      totalSynced: result.totalSynced,
    });
  } catch (err) {
    if (err?.response?.data?.error?.errors?.[0]?.reason === 'commentsDisabled') {
      return res.status(200).json({
        message: 'Comments are disabled for this video',
        totalSynced: 0,
      });
    }
    next(err);
  }
}

