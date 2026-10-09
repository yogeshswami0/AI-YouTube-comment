import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

//100 req/ 15 min per user/IP
export const apilimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    validate: { trustProxy: false },
    handler: (req, res) => {
        if (req.headers.accept?.includes('text/html')) {
            return res.redirect(`${env.CLIENT_URL}/?error=rate_limit`);
        }
        res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
});

export const authLimiter=rateLimit({
    windowMs:15*60*1000,
    max:20,
    validate: { trustProxy: false },
    handler: (req, res) => {
        // Redirect to frontend with error instead of showing raw JSON
        res.redirect(`${env.CLIENT_URL}/?error=rate_limit`);
    },
});