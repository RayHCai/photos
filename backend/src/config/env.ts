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
    APP_PASSWORD: z.string().min(12, 'APP_PASSWORD must be at least 12 characters'),
    SESSION_TTL_DAYS: z.coerce.number().default(30),
    MAX_FILE_SIZE_MB: z.coerce.number().default(5000),
    PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().default(900),
    WORKER_URL: z.string().default('http://localhost:8001'),
    /**
     * Shared secret for the worker->backend /internal surface. Required with real
     * entropy: this is the only thing standing between an unauthenticated caller
     * and presigned URLs for every object in the bucket. There is deliberately no
     * default — a blank value used to disable auth entirely (fail-open), so the
     * process must now refuse to boot instead.
     */
    WORKER_SECRET: z.string().min(32, 'WORKER_SECRET must be at least 32 characters'),
    /**
     * Signs session tokens stored in the Redis cache so a forged cache entry
     * cannot mint a session. See config/redis.ts.
     */
    SESSION_SIGNING_SECRET: z.string().min(32, 'SESSION_SIGNING_SECRET must be at least 32 characters'),
    HNSW_EF_SEARCH: z.coerce.number().default(100),
    /**
     * CLIP semantic search. Off by default because it requires the worker to be
     * reachable over HTTP from the backend; when disabled, search falls back to
     * Postgres full-text and reports searchType 'fts' honestly rather than
     * claiming 'semantic'.
     */
    SEMANTIC_SEARCH_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CDN_BASE_URL: z.string().url().optional(),
    /**
     * Needed to purge deleted objects from the edge. Without it, deleting a photo
     * removes the S3 object but CloudFront keeps serving the cached bytes, and because
     * responses are stamped immutable any client that already fetched the URL keeps its
     * copy for a year.
     */
    CDN_DISTRIBUTION_ID: z.string().optional(),
    /** Number of trusted reverse-proxy hops in front of Express (Vercel rewrite, ALB, nginx). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    /** Opt-in third-party reverse geocoding. Off by default: it egresses photo GPS. */
    GEOCODING_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
