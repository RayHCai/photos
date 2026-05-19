import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
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
        const session = await prisma.session.findUnique({
            where: { token },
        });

        if (!session || session.expiresAt < new Date()) {
            if (session) {
                logger.warn({ sessionId: session.id, ip: req.ip }, 'auth: expired session cleaned up');
                await prisma.session.delete({ where: { id: session.id } });
            } else {
                logger.warn({ ip: req.ip, path: req.originalUrl }, 'auth: invalid token');
            }
            return res.status(401).json({ error: 'Session expired' });
        }

        req.sessionId = session.id;
        next();
    }
    catch (error) {
        next(error);
    }
};
