import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { secretEquals } from '../utils/crypto.js';

/**
 * Guards the /internal surface with the shared worker secret.
 *
 * There is deliberately no "secret not configured -> allow" branch: env.ts now
 * requires WORKER_SECRET with a 32-char minimum, so the process cannot boot
 * without one. The previous fail-open made every /internal route — including
 * presigned downloads for arbitrary S3 keys — reachable unauthenticated under
 * the shipped .env.example.
 */
export const serviceAuthMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const provided = req.headers['x-service-secret'] as string | undefined;

    if (!provided) {
        logger.warn({ ip: req.ip, path: req.originalUrl }, 'service auth: missing secret header');
        return res.status(401).json({ error: 'Missing service secret' });
    }

    if (!secretEquals(provided, env.WORKER_SECRET)) {
        logger.warn({ ip: req.ip, path: req.originalUrl }, 'service auth: invalid secret');
        return res.status(401).json({ error: 'Invalid service secret' });
    }

    next();
};
