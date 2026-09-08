import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Progress tracking for one in-flight archive download.
 *
 * The client cannot measure this download itself. The zip is streamed as it is
 * built and carries no Content-Length (see archive.service), and the response is
 * fetched by a form navigation rather than by the page — on a phone that is the
 * only way the bytes become a real download at all, and it means they never pass
 * through JavaScript. So the only place that knows how far along an archive is,
 * is the process writing it, and the client has to ask.
 *
 * Redis rather than a module-level Map: the poll is a separate request that may
 * land on a different backend instance than the one streaming, and a key with a
 * TTL cannot leak a record for a download that died mid-flight.
 */

const KEY_PREFIX = 'archive:progress:';

/**
 * How long a record for a live archive survives without an update. Long enough to
 * cover a large selection stalling on one slow object, short enough that an
 * abandoned download is not remembered for the rest of the day.
 */
const ACTIVE_TTL_SECONDS = 15 * 60;

/** A finished record only has to outlive the client's next poll. */
const TERMINAL_TTL_SECONDS = 120;

/**
 * Shape of an acceptable progress token. The token becomes part of a Redis key,
 * and it arrives in a form field, so it is constrained rather than trusted — a
 * `crypto.randomUUID()` from the client satisfies this.
 */
export const ARCHIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type ArchiveProgressStatus =
    /** The request has been accepted; nothing has been written yet. */
    | 'preparing'
    /** Bytes are moving. */
    | 'streaming'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface ArchiveProgress {
    status: ArchiveProgressStatus;
    totalItems: number;
    completedItems: number;
    /** 0 when the total is not known, which the client reads as indeterminate. */
    totalBytes: number;
    sentBytes: number;
    /** Name of the zip, once one has been decided. */
    fileName: string;
    error?: string;
}

const TERMINAL_STATUSES: readonly ArchiveProgressStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminal(status: ArchiveProgressStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

function key(token: string): string {
    return `${KEY_PREFIX}${token}`;
}

/**
 * Every operation here is best-effort.
 *
 * Progress is a readout, not part of the download: if Redis is unreachable the
 * user must still get their zip, with the panel falling back to reporting an
 * unknown amount of work. So nothing in this module is allowed to throw into the
 * streaming path.
 */
async function safely<T>(what: string, op: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await op();
    }
    catch (err) {
        logger.warn({ err }, `archive progress: ${what} failed`);
        return fallback;
    }
}

async function write(
    token: string,
    fields: Record<string, string | number>,
    ttlSeconds: number
): Promise<void> {
    await safely<void>(
        'write',
        async () => {
            await redisConnection
                .multi()
                .hset(key(token), fields)
                .expire(key(token), ttlSeconds)
                .exec();
        },
        undefined
    );
}

/**
 * Record that a request has been accepted, before anything is known about its
 * size. Written as early as possible so the client's first poll finds something —
 * a poll that finds nothing is indistinguishable from a request that never
 * arrived, and the client eventually gives up on it.
 */
export async function startProgress(token: string, totalItems: number): Promise<void> {
    await write(
        token,
        {
            status: 'preparing',
            totalItems,
            completedItems: 0,
            totalBytes: 0,
            sentBytes: 0,
            fileName: '',
            error: '',
            cancel: '',
        },
        ACTIVE_TTL_SECONDS
    );
}

/** Fill in what only the streaming side knows, and move off `preparing`. */
export async function beginStreaming(
    token: string,
    info: { totalItems: number; totalBytes: number; fileName: string }
): Promise<void> {
    await write(
        token,
        {
            status: 'streaming',
            totalItems: info.totalItems,
            totalBytes: info.totalBytes,
            fileName: info.fileName,
        },
        ACTIVE_TTL_SECONDS
    );
}

/**
 * Publish a progress sample.
 *
 * Returns whether the client has since asked to cancel, which is why this reads
 * as well as writes: the streaming request is already committed to its response
 * and has no other moment to notice. Piggybacking the check on an update the
 * stream was making anyway keeps it off a timer of its own.
 */
export async function recordProgress(
    token: string,
    sample: { completedItems: number; sentBytes: number }
): Promise<{ cancelRequested: boolean }> {
    return safely(
        'update',
        async () => {
            const results = await redisConnection
                .multi()
                .hset(key(token), {
                    completedItems: sample.completedItems,
                    sentBytes: sample.sentBytes,
                })
                .expire(key(token), ACTIVE_TTL_SECONDS)
                .hget(key(token), 'cancel')
                .exec();
            // [[err, value], ...] in command order; the hget is last.
            return { cancelRequested: results?.[2]?.[1] === '1' };
        },
        { cancelRequested: false }
    );
}

export async function finishProgress(
    token: string,
    status: ArchiveProgressStatus,
    error?: string
): Promise<void> {
    await write(token, { status, ...(error ? { error } : {}) }, TERMINAL_TTL_SECONDS);
}

/**
 * Ask the streaming request to stop.
 *
 * A flag rather than a direct abort: the request writing the zip may be held by
 * another instance, and this one has no handle on its socket. It is picked up on
 * the stream's next progress sample. Returns false when there is no such record,
 * so the caller can tell a stale token from a live one.
 */
export async function requestCancel(token: string): Promise<boolean> {
    return safely(
        'cancel',
        async () => {
            if ((await redisConnection.exists(key(token))) === 0) return false;
            await redisConnection.hset(key(token), { cancel: '1' });
            return true;
        },
        false
    );
}

function toInt(raw: string | undefined): number {
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
}

export async function readProgress(token: string): Promise<ArchiveProgress | null> {
    return safely<ArchiveProgress | null>(
        'read',
        async () => {
            const raw = await redisConnection.hgetall(key(token));
            if (!raw || Object.keys(raw).length === 0) return null;
            return {
                status: (raw.status || 'preparing') as ArchiveProgressStatus,
                totalItems: toInt(raw.totalItems),
                completedItems: toInt(raw.completedItems),
                totalBytes: toInt(raw.totalBytes),
                sentBytes: toInt(raw.sentBytes),
                fileName: raw.fileName || '',
                ...(raw.error ? { error: raw.error } : {}),
            };
        },
        null
    );
}
