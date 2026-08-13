import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { httpLogger } from './middleware/httpLogger.js';
import { rateLimiter, authRateLimiter, internalRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import internalRoutes from './routes/internal.routes.js';
import healthRoutes from './routes/health.routes.js';

/**
 * Prisma returns BigInt for media_items.file_size, and JSON.stringify throws on
 * BigInt. This used to be handled by patching BigInt.prototype.toJSON to
 * Number(this) — which mutated a global built-in for every dependency in the
 * process and silently lost precision above 2^53.
 *
 * An Express-scoped json replacer is equivalent in reach but local, and emitting
 * a string is lossless. The frontend already declares `fileSize: string` and
 * `formatFileSize` already accepts a string, so this also removes a live
 * type/runtime mismatch.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

export function createApp() {
    const app = express();

    app.set('json replacer', bigIntReplacer);

    /**
     * Express derives req.ip from the socket unless told how many proxy hops to
     * trust. The frontend proxies /api/* through Next.js (and in production
     * through Vercel), so without this every client shared one rate-limit bucket
     * keyed to the proxy address — five bad logins locked out the entire
     * deployment for 15 minutes.
     */
    if (env.TRUST_PROXY_HOPS > 0) {
        app.set('trust proxy', env.TRUST_PROXY_HOPS);
    }

    app.use(compression());
    app.use(
        helmet({
            // API responses are never rendered as documents, so a CSP here would
            // only shadow the one the frontend sets on its own HTML.
            contentSecurityPolicy: false,
            crossOriginResourcePolicy: { policy: 'same-site' },
            referrerPolicy: { policy: 'no-referrer' },
        })
    );

    app.use(
        cors({
            origin: env.CORS_ORIGIN,
            credentials: true,
            methods: ['GET', 'POST', 'PATCH', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        })
    );

    app.use(requestIdMiddleware);
    app.use(httpLogger);
    app.use(cookieParser());

    // Liveness/readiness ahead of auth and rate limiting so an orchestrator can
    // always reach them.
    app.use(healthRoutes);

    /**
     * Body parsers are mounted per-router rather than globally. A global
     * express.json() runs first and sets req._body, which makes every later
     * parser short-circuit — so the 50mb limit intended for embedding batches was
     * dead code and /internal was silently capped at 1mb.
     */
    app.use(
        '/api/v1',
        express.json({ limit: '1mb' }),
        express.urlencoded({ extended: false, limit: '1mb' })
    );

    app.use('/api/v1', rateLimiter);
    app.use('/api/v1/auth/login', authRateLimiter);
    app.use('/api/v1', routes);

    // Internal service surface: larger body limit for 512-dim embedding batches,
    // and rate limited so a leaked secret cannot trivially exhaust the process.
    app.use('/internal', express.json({ limit: '50mb' }), internalRateLimiter, internalRoutes);

    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use(errorHandler);

    return app;
}
