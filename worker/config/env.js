import {z} from "zod";
import dotenv from "dotenv";

dotenv.config({ override: true , quiet:true});

const envSchema=z.object({
    NODE_ENV:z.enum(['development','production','test']).default('development'),
    PORT:z.string().default('5000'),
    MONGODB_URI:z.string().min(1,'MONGODB_URI is required!'),

    GOOGLE_CLIENT_ID:z.string().min(1,'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET:z.string().min(1,'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI:z.string().min(1,'GOOGLE_REDIRECT_URI is required'),

    SESSION_SECRET:z.string().min(1,'SESSION_SECRET is required'),

    CORS_WHITELIST: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((url) => url.trim())),
    
    CLIENT_URL:z.string().default('http://localhost:5173'),
    AI_SERVICE_URL:z.string().default('http://localhost:8000'),
    RAG_SERVICE_URL:z.string().default('http://localhost:8001'),

    REDIS_URL: z.string().min(1,'REDIS_URL is required!'),
    REDIS_PORT:z.string().default('12764'),
    REDIS_USERNAME:z.string().default('default'),
    REDIS_PASSWORD:z.string().min(1,'REDIS_PASSWORD is required'),
    REDIS_BULL_PREFIX:z.string().min(1,'REDIS_BULL_PREFIX is required'),

    YOUTUBE_API_KEY:z.string().min(1,'YOUTUBE_API_KEY is required'),
});

const parsed=envSchema.safeParse(process.env);

if(!parsed.success){
    console.error("Invalid environment variables ",parsed.error.format());
    process.exit(1);
}

export const env=parsed.data;
