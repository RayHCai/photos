import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { cacheSession } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { secretEquals } from '../utils/crypto.js';

export async function login(
    password: string,
    userAgent?: string,
    ipAddress?: string
) {
    // secretEquals hashes both sides to a fixed width before comparing, so the
    // comparison stays constant-time without a length check that would leak the
    // expected password length.
    if (!secretEquals(password, env.APP_PASSWORD)) {
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
