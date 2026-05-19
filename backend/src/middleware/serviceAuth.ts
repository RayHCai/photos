import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const serviceAuthMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!env.WORKER_SECRET) {
        return next();
    }

    const provided = req.headers['x-service-secret'] as string | undefined;

    if (!provided) {
        logger.warn({ ip: req.ip, path: req.originalUrl }, 'service auth: missing secret header');
        return res.status(401).json({ error: 'Missing service secret' });
    }

    const expected = Buffer.from(env.WORKER_SECRET, 'utf-8');
    const actual = Buffer.from(provided, 'utf-8');

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        logger.warn({ ip: req.ip, path: req.originalUrl }, 'service auth: invalid secret');
        return res.status(401).json({ error: 'Invalid service secret' });
    }

    next();
};
