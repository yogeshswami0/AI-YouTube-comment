import { getValidYoutubeToken } from "../utils/youtubeToken.helper.js";
import logger from "../utils/logger.js";

/**
 * Attaches a valid YouTube OAuth access token to req.ytToken for the authenticated user.
 */
const youtubeTokenMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?._id?.toString();

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    req.ytToken = await getValidYoutubeToken(userId);
    next();
  } catch (error) {
    logger.error("youtubeToken middleware error:", error);

    if (error.reAuthNeeded) {
      return res.status(401).json({
        error: error.message,
        reAuthUrl: "/api/auth/google",
      });
    }

    return res.status(401).json({
      error:
        "Failed to validate Youtube token - Please re-authenticate",
      reAuthUrl: "/api/auth/google",
    });
  }
};

export default youtubeTokenMiddleware;
