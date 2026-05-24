import { Request, Response, NextFunction } from 'express';
import { validateSessionToken } from '../config/redis.js';
import { logger } from '../utils/logger.js';

export const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const token =
        req.headers.authorization?.replace('Bearer ', '') ||
        req.cookies?.session_token;

    if (!token) {
        logger.warn({ ip: req.ip, path: req.originalUrl }, 'auth: no token provided');
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const session = await validateSessionToken(token);
        if (!session) {
            logger.warn({ ip: req.ip, path: req.originalUrl }, 'auth: invalid or expired token');
            return res.status(401).json({ error: 'Session expired' });
        }

        req.sessionId = session.id;
        next();
    }
    catch (error) {
        next(error);
    }
};
