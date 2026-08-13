import { Redis } from 'ioredis';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { signSessionToken, verifySessionSignature } from '../utils/crypto.js';

export const redisConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
    logger.error({ err }, 'redis: connection error');
});

// ─── Session cache ──────────────────────────────────────────
const SESSION_CACHE_TTL = 300; // 5 minutes
const SESSION_PREFIX = 'session:';

interface CachedSession {
    id: string;
    expiresAt: Date;
}

function sessionPayload(token: string, sessionId: string, expiresAtIso: string): string {
    return `${token}:${sessionId}:${expiresAtIso}`;
}

export async function cacheSession(
    token: string,
    sessionId: string,
    expiresAt: Date,
): Promise<void> {
    const expiresAtIso = expiresAt.toISOString();
    const value = JSON.stringify({
        id: sessionId,
        expiresAt: expiresAtIso,
        // Binds this entry to (token, sessionId, expiry) under a secret only the
        // backend holds.
        sig: signSessionToken(
            sessionPayload(token, sessionId, expiresAtIso),
            env.SESSION_SIGNING_SECRET
        ),
    });
    await redisConnection.setex(`${SESSION_PREFIX}${token}`, SESSION_CACHE_TTL, value);
}

export async function getCachedSession(token: string): Promise<CachedSession | null> {
    const raw = await redisConnection.get(`${SESSION_PREFIX}${token}`);
    if (!raw) return null;

    let parsed: { id?: unknown; expiresAt?: unknown; sig?: unknown };
    try {
        parsed = JSON.parse(raw) as typeof parsed;
    }
    catch {
        await invalidateSession(token);
        return null;
    }

    if (typeof parsed.id !== 'string' || typeof parsed.expiresAt !== 'string') {
        await invalidateSession(token);
        return null;
    }

    /**
     * The cache is consulted before Postgres, so an unauthenticated entry is a
     * full session-forgery primitive for anyone who can write to Redis. Reject
     * any entry this process did not sign and fall through to the database.
     */
    if (
        !verifySessionSignature(
            sessionPayload(token, parsed.id, parsed.expiresAt),
            parsed.sig,
            env.SESSION_SIGNING_SECRET
        )
    ) {
        logger.error(
            { sessionId: parsed.id },
            'session cache: rejected entry with invalid signature'
        );
        await invalidateSession(token);
        return null;
    }

    return { id: parsed.id, expiresAt: new Date(parsed.expiresAt) };
}

export async function invalidateSession(token: string): Promise<void> {
    await redisConnection.del(`${SESSION_PREFIX}${token}`);
}

/**
 * Validate a session token against cache then DB.
 * Returns session info if valid, null otherwise.
 */
export async function validateSessionToken(token: string): Promise<CachedSession | null> {
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
