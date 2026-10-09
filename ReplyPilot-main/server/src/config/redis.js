import { createClient } from "redis";
import Redis from "ioredis";
import { env } from "./env.js";
import logger from "../utils/logger.js";


let redisOptions = {
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    socket: {
        host: env.REDIS_URL,
        port: parseInt(env.REDIS_PORT),
        reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
    },
    pingInterval: 60_000,   // send PING every 60s to prevent idle-timeout disconnects
};

if (env.REDIS_URL.startsWith('redis://') || env.REDIS_URL.startsWith('rediss://')) {
    redisOptions = {
        url: env.REDIS_URL,
        socket: {
            reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
        },
        pingInterval: 60_000,
    };
}

const redis = createClient(redisOptions);

redis.on("connect", () => logger.info("Redis (node-redis) connected"));
redis.on("error", (err) => logger.error("Redis error", err));
redis.on("reconnecting", () => logger.warn("Redis reconnecting"));

await redis.connect();

const bullOptions = {
  maxRetriesPerRequest: null,
  keepAlive: 60_000,       // TCP keepalive every 60s
};

export const bullConnection = (env.REDIS_URL.startsWith('redis://') || env.REDIS_URL.startsWith('rediss://'))
  ? new Redis(env.REDIS_URL, bullOptions)
  : new Redis({
      host: env.REDIS_URL,
      port: parseInt(env.REDIS_PORT),
      username: env.REDIS_USERNAME,
      password: env.REDIS_PASSWORD,
      ...bullOptions
    });

bullConnection.on("connect", () =>
  logger.info("Redis (ioredis) connected for BullMQ")
);
bullConnection.on("error", (err) =>
  logger.error("ioredis error", err)
);

// Keys
export const keys = {
  ytAccessToken: (userId) => `yt:access_token:${userId}`,
  ytTokenExpiry: (userId) => `yt:token_expiry:${userId}`,
  channelCache: (channelId) => `cache:channel:${channelId}`,
  videoCache: (videoId) => `cache:video:${videoId}`,
  session: (sessionId) => `session:${sessionId}`,
};

export default redis;