import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { cacheSession } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export async function login(
    password: string,
    userAgent?: string,
    ipAddress?: string
) {
    const expected = Buffer.from(env.APP_PASSWORD);
    const received = Buffer.from(password);

    if (
        expected.length !== received.length ||
        !crypto.timingSafeEqual(expected, received)
    ) {
        logger.warn({ ipAddress }, 'auth: invalid password attempt');
        throw new AppError(401, 'Invalid password');
    }

    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.SESSION_TTL_DAYS);

    const session = await prisma.session.create({
        data: {
            token,
            userAgent,
            ipAddress,
            expiresAt,
        },
    });

    await cacheSession(session.token, session.id, session.expiresAt);
    logger.info({ sessionId: session.id, ipAddress, expiresAt }, 'auth: session created');
    return { token: session.token, expiresAt: session.expiresAt };
}

export async function getSessionStatus(sessionId: string) {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
    });
    return session
        ? { valid: true, expiresAt: session.expiresAt }
        : { valid: false };
}
