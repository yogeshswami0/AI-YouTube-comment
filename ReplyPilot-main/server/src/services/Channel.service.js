import { buildYoutubeClient } from "../utils/youtubeClient.js";
import { ApiError } from "../utils/ApiError.js";
import ChannelMapper from "../mapper/Channel.mapper.js";
import Channel from "../models/Channel.models.js";
import User from "../models/User.models.js";
import logger from "../utils/logger.js";
import { invalidateUserCache } from "../config/passport.js";
import { fetchAllPages, paginateYT } from "../utils/paginate.js";
import VideoMapper from "../mapper/Video.mapper.js";
import Video from "../models/Video.models.js";
import CommentMapper from "../mapper/Comment.mapper.js";
import Comment from "../models/Comment.models.js";

export const getChannelInfo = async (AccessToken,userId) => {
  const yt=buildYoutubeClient(AccessToken);

  const response=await yt.channels.list({
    part:['snippet', 'statistics', 'brandingSettings', 'contentDetails'],
    mine:true,
    maxResults:1,
  });

  const channel= response.data.items?.[0];
  if(!channel){
    throw new ApiError(404,'No YouTube channel found for this account');
  }

  const ChannelData=ChannelMapper(channel,userId);

  const saved = await Channel.findOneAndUpdate(
    {channelId:channel.id},
    ChannelData,
    {upsert:true,new:true},
  );

  await User.findByIdAndUpdate(userId,{channelId:channel.id});
  await invalidateUserCache(userId);

  logger.info(`Channel Synced: ${saved.title} (${saved.channelId})`);
  return saved;
};
export const getChannelVideosInfo = async (accessToken,userId,options={}) => {
  const {
    pageToken=undefined,
    maxResults=50,
    fetchAll=false,
  } = options;

  const yt=buildYoutubeClient(accessToken);

  const channel = await Channel.findOne({userId}).lean();
  if(!channel){
    throw new ApiError(404,'Channel not found. Fetch channel first');
  }

  const uploadsPlaylistId = channel._uploadsPlaylistId;
  if(!uploadsPlaylistId){
    throw new ApiError(404,'Uploads playlist ID not found');
  }

  const fetchPlaylistPage = async (token) => {
    return yt.playlistItems.list({
      part:       ['snippet', 'contentDetails', 'status'],
      playlistId: uploadsPlaylistId,
      maxResults,
      pageToken:  token,
    });
  };

  const getVideoIds = (res) =>
    res.data.items
      .filter((i) => i.status?.privacyStatus !== 'private')
      .map((i) => i.contentDetails.videoId);
  
  let videoIds = [];
  let rawResponse;

  if(fetchAll){
    videoIds = await fetchAllPages(fetchPlaylistPage,getVideoIds);
  }else{
    rawResponse = await fetchPlaylistPage(pageToken);
    videoIds = getVideoIds(rawResponse);
  }

  if (!videoIds.length) {
    return fetchAll
      ? { items: [], totalSynced: 0 }
      : paginateYT(rawResponse, []);
  }

  const BATCH = 50;
  const allVideos = [];

  for (let i = 0; i < videoIds.length; i += BATCH) {
    const batchIds = videoIds.slice(i, i + BATCH);
    const detailRes = await yt.videos.list({
      part: ['snippet', 'statistics', 'contentDetails', 'status'],
      id:   batchIds,
    });

    const mapped = detailRes.data.items.map((v) => VideoMapper(v, channel.channelId, userId));
    allVideos.push(...mapped);
  }

  if (allVideos.length) {
    const ops = allVideos.map((v) => ({
      updateOne: {
        filter:  { videoId: v.videoId },
        update:  { $set: v },
        upsert:  true,
      },
    }));
    await Video.bulkWrite(ops, { ordered: false });
  }

  logger.info(`Synced ${allVideos.length} videos for channel ${channel.channelId}`);

  if (fetchAll) {
    return { items: allVideos, totalSynced: allVideos.length };
  }

  return paginateYT(rawResponse, allVideos);
};

export const getVideoInfo = async (accessToken, videoId, userId) => {
  const yt = buildYoutubeClient(accessToken);

  const response = await yt.videos.list({
    part: ['snippet', 'statistics', 'contentDetails', 'status', 'localizations'],
    id:   [videoId],
  });

  const item = response.data.items?.[0];
  if (!item) {
    throw new ApiError(404,`Video ${videoId} not found`);
  }

  const channelId = item.snippet.channelId;
  const mapped    = VideoMapper(item, channelId, userId);

  const saved = await Video.findOneAndUpdate(
    { videoId },
    { $set: { ...mapped, lastSyncedAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );

  logger.info(`Video synced: "${saved.title}" (${videoId})`);
  return saved;
};

export const getVideoCommentsInfo = async (accessToken, videoId, options = {}) => {
  const {
    pageToken  = undefined,
    maxResults = 100,
    order      = 'relevance', // relevance | time
    fetchAll   = false,
  } = options;

  const yt = buildYoutubeClient(accessToken);

  const video = await Video.findOne({ videoId }).lean();
  if (video?.commentsDisabled) {
    return { items: [], message: 'Comments are disabled for this video' };
  }

  const fetchPage = async (token) => {
    return yt.commentThreads.list({
      part:       ['snippet', 'replies'],
      videoId,
      maxResults,
      order,
      pageToken:  token,
    });
  };

  const mapComments = (res) => {
    const comments = [];
    for (const thread of res.data.items) {
      // Top-level comment
      const top = thread.snippet.topLevelComment;
      comments.push(CommentMapper(top, videoId, video?.channelId, false, null));

      // Inline replies (up to 5 returned by default)
      if (thread.replies?.comments?.length) {
        for (const reply of thread.replies.comments) {
          comments.push(CommentMapper(reply, videoId, video?.channelId, true, top.id));
        }
      }
    }
    return comments;
  };

  let allComments = [];
  let rawResponse;

  if (fetchAll) {
    allComments = await fetchAllPages(fetchPage, mapComments);
  } else {
    rawResponse = await fetchPage(pageToken);
    allComments = mapComments(rawResponse);
  }

  if (allComments.length) {
    const ops = allComments.map((c) => ({
      updateOne: {
        filter: { ytCommentId: c.ytCommentId },
        update: {
          $setOnInsert: { intents: [], classificationStatus: 'pending' },
          $set: {
            videoId:         c.videoId,
            channelId:       c.channelId,
            text:            c.text,
            textDisplay:     c.textDisplay,
            authorName:      c.authorName,
            authorChannelId: c.authorChannelId,
            authorAvatar:    c.authorAvatar,
            likeCount:       c.likeCount,
            replyCount:      c.replyCount,
            publishedAt:     c.publishedAt,
            isReply:         c.isReply,
            parentId:        c.parentId,
          },
        },
        upsert: true,
      },
    }));
    await Comment.bulkWrite(ops, { ordered: false });
  }

  logger.info(`Synced ${allComments.length} comments for video ${videoId}`);


  if (fetchAll) {
    return { items: allComments, totalSynced: allComments.length };
  }

  return paginateYT(rawResponse, allComments);
};
