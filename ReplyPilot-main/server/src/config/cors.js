import { env } from "./env.js";

const WHITELIST_URL = new Set(env.CORS_WHITELIST);

const BASE_CORS = {
  credentials: true,
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-Requested-With",
    "Accept",
  ],
  exposedHeaders: ["Authorization", "Content-Length"],
  methods: ["GET", "PUT", "PATCH", "DELETE", "POST"],
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

function cors_option(req, cb) {
  const origin = req.get("Origin");

  if (!origin) return cb(null, { origin: true, ...BASE_CORS });

  const allowed =
    WHITELIST_URL.size === 0 || WHITELIST_URL.has(origin);

  cb(null, allowed ? { origin: true, ...BASE_CORS } : { origin: false });
}

export default cors_option;