import { google } from "googleapis";
import redis, { keys } from "../config/redis.js";
import User from "../models/User.models.js";
import { env } from "../config/env.js";
import logger from "./logger.js";
import { decrypt } from "./crypto.js";

// "Memory Board" to prevent race conditions during refresh
const ongoingRefreshPromises = new Map();

/**
 * Retrieves a valid YouTube OAuth access token for the given user ID.
 * Refreshes it if it is expired or missing from Redis.
 */
export async function getValidYoutubeToken(userId) {
  if (!userId) {
    throw new Error("UserId is required to fetch youtube token");
  }

  const cachedToken = await redis.get(keys.ytAccessToken(userId));
  const expiryStr = await redis.get(keys.ytTokenExpiry(userId));
  const expiryAt = expiryStr ? Number(expiryStr) : 0;
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

  if (cachedToken && Date.now() < expiryAt - bufferMs) {
    return cachedToken;
  }

  const user = await User.findById(userId).select("+refreshToken").lean();
  if (!user?.refreshToken) {
    const err = new Error("Youtube not connected - Please reauthenticate");
    err.reAuthNeeded = true;
    throw err;
  }

  if (ongoingRefreshPromises.has(userId)) {
    logger.debug(
      `Request for user ${userId} is waiting for an ongoing refresh to finish...`
    );
    return await ongoingRefreshPromises.get(userId);
  }

  // Decrypt the stored refresh token
  const decryptedRefreshToken = decrypt(user.refreshToken);

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: decryptedRefreshToken });

  const refreshPromise = new Promise((resolve, reject) => {
    oauth2Client
      .refreshAccessToken()
      .then(async ({ credentials }) => {
        const newAccessToken = credentials.access_token;
        const newExpiresAt =
          credentials.expiry_date ?? Date.now() + 60 * 60 * 1000;
        const ttlSeconds = Math.floor((newExpiresAt - Date.now()) / 1000);

        await redis.set(keys.ytAccessToken(userId), newAccessToken, {
          EX: ttlSeconds,
        });
        await redis.set(keys.ytTokenExpiry(userId), String(newExpiresAt), {
          EX: ttlSeconds,
        });

        logger.debug("Access Token refreshed for user:", userId);
        resolve(newAccessToken);
      })
      .catch(reject);
  });

  ongoingRefreshPromises.set(userId, refreshPromise);
  refreshPromise.finally(() => ongoingRefreshPromises.delete(userId));

  return await refreshPromise;
}
