import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { httpLogger } from './middleware/httpLogger.js';
import { rateLimiter, authRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import internalRoutes from './routes/internal.routes.js';

// Allow JSON.stringify to serialize BigInt values (e.g. Prisma BigInt fields)
(BigInt.prototype as any).toJSON = function () {
    return Number(this);
};

export function createApp() {
    const app = express();

    app.use(helmet());

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

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(cookieParser());

    app.use('/api/v1', rateLimiter);
    app.use('/api/v1/auth/login', authRateLimiter);

    app.use('/api/v1', routes);

    // Internal service routes - larger body limit for embedding payloads, no rate limiting
    app.use('/internal', express.json({ limit: '50mb' }), internalRoutes);

    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use(errorHandler);

    return app;
}
