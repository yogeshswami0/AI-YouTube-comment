import express from 'express';

import authMiddleware from '../middleware/auth.middleware.js';
import youtubeTokenMiddleware from '../middleware/youtubeToken.middleware.js';

import {
  getChannelDetails,
  getChannelVideos,
  getVideoDetails,
  getVideoComments,
  syncVideoComments,
} from '../controllers/Channel.controller.js';

const router = express.Router();

const protect = [authMiddleware,youtubeTokenMiddleware];

router.route("/").get(protect,getChannelDetails);

router.route("/videos").get(protect,getChannelVideos);

router.route("/videos/:videoId").get(protect,getVideoDetails);

router.route("/videos/:videoId/comments").get(protect,getVideoComments);

router.route("/videos/:videoId/comments/sync").post(protect,syncVideoComments);


export default router;
