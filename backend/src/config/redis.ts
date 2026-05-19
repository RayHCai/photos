import { Redis } from 'ioredis';
import { env } from './env.js';

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
