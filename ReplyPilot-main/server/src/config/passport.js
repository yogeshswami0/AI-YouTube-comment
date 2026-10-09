import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "./env.js";
import { YT_SCOPES } from "./constants.js";
import User from "../models/User.models.js";
import redis, { keys } from './redis.js';
import logger from "../utils/logger.js";
import { encrypt } from "../utils/crypto.js";

const USER_CACHE_TTL = 15 * 60; // 15 min
const userCacheKey = (userId) => `cache:user:${userId}`;

passport.use(
    new GoogleStrategy(
        {
            clientID: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            callbackURL: env.GOOGLE_REDIRECT_URI,
            scope: YT_SCOPES,
            accessType: 'offline',
            prompt: 'consent'
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const encryptedToken = refreshToken ? encrypt(refreshToken) : undefined;

                const updatePayload = {
                    googleId: profile.id,
                    email: profile.emails[0].value,
                    displayName: profile.displayName,
                    avatar: profile.photos?.[0]?.value,
                    refreshToken:encryptedToken
                };

                const user = await User.findOneAndUpdate(
                    { googleId: profile.id },
                    updatePayload,
                    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
                );

                const TTL = 55 * 60; // 55 min

                await redis.set(
                    keys.ytAccessToken(user._id.toString()),
                    accessToken,
                    { EX: TTL }
                );

                await redis.set(
                    keys.ytTokenExpiry(user._id.toString()),
                    String(Date.now() + TTL * 1000),
                    { EX: TTL }
                );

                await redis.set(
                    userCacheKey(user._id.toString()),
                    JSON.stringify(user.toJSON()),
                    { EX: USER_CACHE_TTL }
                );

                logger.info(`OAuth success for user ${user.email}`);
                return done(null, user);
            } catch (error) {
                logger.error('OAuth Strategy error:', error.message);
                return done(error, null);
            }
        }
    )
);

passport.serializeUser((user, done) => done(null, user._id.toString()));

passport.deserializeUser(async (id, done) => {
    try {
        // Try Redis cache first — avoid DB hit on every request
        const cached = await redis.get(userCacheKey(id));
        if (cached) {
            return done(null, JSON.parse(cached));
        }

        // Cache miss — fetch from MongoDB and cache
        const user = await User.findById(id).lean();
        if (user) {
            await redis.set(
                userCacheKey(id),
                JSON.stringify(user),
                { EX: USER_CACHE_TTL }
            );
        }
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

/**
 * Invalidate the cached user profile (call after profile updates).
 */
export async function invalidateUserCache(userId) {
    await redis.del(userCacheKey(userId));
}

export default passport;