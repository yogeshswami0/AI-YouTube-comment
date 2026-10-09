import { google } from "googleapis";
import redis, { keys } from "../config/redis.js";
import User from "../models/User.models.js";
import { env } from "../config/env.js";
import logger from "./logger.js";

// "Memory Board" to prevent race conditions during refresh
const ongoingRefreshPromises = new Map(); 

/**
 * Retrieves a valid YouTube OAuth Access token for the given user ID.
 * Refreshes it if it is expired or missing from Redis.
 * @param {string} userId - The ID of the authenticated user
 * @returns {Promise<string>} - The valid YouTube access token
 * @throws {Error} - Throws if user is missing refresh token or auth fails
 */
export async function getValidYoutubeToken(userId) {
    if (!userId) {
        throw new Error('UserId is required to fetch youtube token');
    }

    const cachedToken = await redis.get(keys.ytAccessToken(userId));
    const expiryStr = await redis.get(keys.ytTokenExpiry(userId));
    const expiryAt = expiryStr ? Number(expiryStr) : 0;
    const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

    // 1. If valid in Redis, return it immediately
    if (cachedToken && Date.now() < expiryAt - bufferMs) {
        return cachedToken;
    }

    // 2. Fetch user to get long-lived refresh token
    const user = await User.findById(userId).select("+refreshToken").lean();
    if (!user?.refreshToken) {
        const err = new Error('Youtube not connected - Please reauthenticate');
        err.reAuthNeeded = true;
        throw err;
    }

    // 3. Check if another request is ALREADY refreshing the token right now
    if (ongoingRefreshPromises.has(userId)) {
        logger.debug(`Request for user ${userId} is waiting for an ongoing refresh to finish...`);
        return await ongoingRefreshPromises.get(userId);
    }

    const oauth2Client = new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });

    // 4. We are Request #1 (the leader). Register the IOU note BEFORE the async
    //    work begins so any concurrent caller that reaches the has() check above
    //    immediately receives this same promise (zero-window race condition fix).
    const refreshPromise = new Promise((resolve, reject) => {
        oauth2Client.refreshAccessToken()
            .then(async ({ credentials }) => {
                const newAccessToken = credentials.access_token;
                const newExpiresAt = credentials.expiry_date ?? Date.now() + 60 * 60 * 1000;
                const ttlSeconds = Math.floor((newExpiresAt - Date.now()) / 1000);

                await redis.set(keys.ytAccessToken(userId), newAccessToken, { EX: ttlSeconds });
                await redis.set(keys.ytTokenExpiry(userId), String(newExpiresAt), { EX: ttlSeconds });

                logger.debug('Access Token refreshed for user:', userId);
                resolve(newAccessToken);
            })
            .catch((refreshError) => {
                // Google returns 'invalid_grant' when the refresh token is revoked,
                // expired, or the app is unverified. Treat these as re-auth needed
                // so the worker can skip this user gracefully instead of crashing.
                const msg = refreshError.message || '';
                if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
                    const err = new Error(`YouTube token invalid for user ${userId} - re-authentication required (${msg})`);
                    err.reAuthNeeded = true;
                    reject(err);
                } else {
                    reject(refreshError);
                }
            });
    });

    // Register synchronously — new Promise() construction is synchronous, so this
    // line runs before any microtask from the executor above can be scheduled.
    ongoingRefreshPromises.set(userId, refreshPromise);

    // 5. Clean up on both settle paths so the map never leaks a stale entry.
    // We add a silent .catch() here solely to prevent Node.js from throwing an
    // UnhandledPromiseRejection crash if the background promise rejects before 
    // it gets awaited below.
    refreshPromise
      .catch((err) => {
        // Log background rejection context for faster debugging before swallowing
        logger.debug(`Background refresh promise rejected for user ${userId}`, { reason: err.message });
      }) 
      .finally(() => ongoingRefreshPromises.delete(userId));

    return await refreshPromise;
}
