import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisConnection, getCachedSession, cacheSession } from '../config/redis.js';
import { prisma } from '../config/prisma.js';

export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: async (req) => {
        const token =
            req.headers.authorization?.replace('Bearer ', '') ||
            req.cookies?.session_token;
        if (!token) return false;

        // Check Redis cache first — avoid DB hit on every request
        const cached = await getCachedSession(token);
        if (cached) return cached.expiresAt > new Date();

        // Cache miss — check DB and populate cache
        const session = await prisma.session.findUnique({
            where: { token },
        });
        if (session && session.expiresAt > new Date()) {
            await cacheSession(token, session.id, session.expiresAt);
            return true;
        }
        return false;
    },
    store: new RedisStore({
        sendCommand: (...args: string[]) =>
            redisConnection.call(args[0], ...args.slice(1)) as any,
    }),
});

export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        sendCommand: (...args: string[]) =>
            redisConnection.call(args[0], ...args.slice(1)) as any,
        prefix: 'rl:auth:',
    }),
});
