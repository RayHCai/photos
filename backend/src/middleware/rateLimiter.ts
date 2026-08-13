import rateLimit, { type Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisConnection } from '../config/redis.js';

const WINDOW_MS = 15 * 60 * 1000;

function baseOptions(prefix: string): Partial<Options> {
    return {
        windowMs: WINDOW_MS,
        standardHeaders: true,
        legacyHeaders: false,
        store: new RedisStore({
            sendCommand: (...args: string[]) =>
                redisConnection.call(args[0]!, ...args.slice(1)) as Promise<never>,
            prefix,
        }),
    };
}

/**
 * Global limiter for the API surface.
 *
 * This deliberately no longer resolves the session itself. It used to call
 * validateSessionToken to decide whether to skip, which duplicated the token
 * extraction authMiddleware performs moments later, added a second Redis round
 * trip (plus a possible DB query) to every request, and meant that changing
 * where the token lives would silently start rate-limiting authenticated users
 * as anonymous.
 *
 * Instead the cap is simply high enough for real interactive use — the gallery
 * legitimately issues hundreds of thumbnail requests per session. Login has its
 * own tight limiter, which is the endpoint that actually needs protecting for a
 * shared-password app.
 */
export const rateLimiter = rateLimit({
    ...baseOptions('rl:api:'),
    limit: 2000,
    // Public share routes carry their own limiter on the route itself.
    skip: (req) => req.path.startsWith('/public/s/'),
});

export const publicShareRateLimiter = rateLimit({
    ...baseOptions('rl:public-share:'),
    // A single viewer scrolling a large shared album issues one request per
    // thumbnail, so 500 locked legitimate viewers out mid-album.
    limit: 2000,
});

export const authRateLimiter = rateLimit({
    ...baseOptions('rl:auth:'),
    limit: 10,
    message: { error: 'Too many login attempts. Try again later.' },
    // Only failed attempts consume budget, so a user signing in from several
    // devices is never locked out by their own success.
    skipSuccessfulRequests: true,
});

/**
 * The /internal surface is service-to-service and previously had no limiter at
 * all. The cap is generous — the worker is chatty, 5-40 calls per media item —
 * but it bounds the damage from a leaked secret.
 */
export const internalRateLimiter = rateLimit({
    ...baseOptions('rl:internal:'),
    limit: 20000,
});
