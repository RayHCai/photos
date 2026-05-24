import { Redis } from 'ioredis';
import { env } from './env.js';
import { prisma } from './prisma.js';

export const redisConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

// ─── Session cache ──────────────────────────────────────────
const SESSION_CACHE_TTL = 300; // 5 minutes
const SESSION_PREFIX = 'session:';

export async function cacheSession(
    token: string,
    sessionId: string,
    expiresAt: Date,
): Promise<void> {
    const value = JSON.stringify({ id: sessionId, expiresAt: expiresAt.toISOString() });
    await redisConnection.setex(`${SESSION_PREFIX}${token}`, SESSION_CACHE_TTL, value);
}

export async function getCachedSession(
    token: string,
): Promise<{ id: string; expiresAt: Date } | null> {
    const raw = await redisConnection.get(`${SESSION_PREFIX}${token}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { id: parsed.id, expiresAt: new Date(parsed.expiresAt) };
}

export async function invalidateSession(token: string): Promise<void> {
    await redisConnection.del(`${SESSION_PREFIX}${token}`);
}

/**
 * Validate a session token against cache then DB.
 * Returns session info if valid, null otherwise.
 */
export async function validateSessionToken(
    token: string,
): Promise<{ id: string; expiresAt: Date } | null> {
    const cached = await getCachedSession(token);
    if (cached) {
        if (cached.expiresAt > new Date()) return cached;
        await invalidateSession(token);
        return null;
    }

    const session = await prisma.session.findUnique({ where: { token } });
    if (session && session.expiresAt > new Date()) {
        await cacheSession(token, session.id, session.expiresAt);
        return { id: session.id, expiresAt: session.expiresAt };
    }
    return null;
}
