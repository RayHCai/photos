import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AWS_REGION: z.string().default('us-east-1'),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    S3_BUCKET: z.string(),
    APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
    SESSION_TTL_DAYS: z.coerce.number().default(30),
    MAX_FILE_SIZE_MB: z.coerce.number().default(5000),
    PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(900),
    WORKER_URL: z.string().default('http://localhost:8001'),
    WORKER_SECRET: z.string().default(''),
    HNSW_EF_SEARCH: z.coerce.number().default(100),
    LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
