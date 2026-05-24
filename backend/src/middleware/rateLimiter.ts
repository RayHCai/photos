import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisConnection, validateSessionToken } from '../config/redis.js';

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

        const session = await validateSessionToken(token);
        return session !== null;
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
