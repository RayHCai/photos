import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A hash store standing in for Redis, and the reason this file mocks
 * config/redis rather than pointing at a server: the real module opens a
 * connection at import time by way of config/env, which refuses to load without a
 * database URL and AWS credentials.
 *
 * It models the two things this service actually depends on — that values come
 * back as strings, and that `multi().exec()` returns `[error, value]` pairs in
 * command order.
 */
const store = new Map<string, Record<string, string>>();
let failNext = false;

function stringify(fields: Record<string, string | number>): Record<string, string> {
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
}

function hset(key: string, fields: Record<string, string | number>) {
    store.set(key, { ...store.get(key), ...stringify(fields) });
}

vi.mock('../config/redis.js', () => {
    const redisConnection = {
        multi() {
            const results: Array<[null, unknown]> = [];
            const chain = {
                hset(key: string, fields: Record<string, string | number>) {
                    hset(key, fields);
                    results.push([null, 1]);
                    return chain;
                },
                expire() {
                    results.push([null, 1]);
                    return chain;
                },
                hget(key: string, field: string) {
                    results.push([null, store.get(key)?.[field] ?? null]);
                    return chain;
                },
                async exec() {
                    if (failNext) throw new Error('redis is down');
                    return results;
                },
            };
            return chain;
        },
        async hgetall(key: string) {
            if (failNext) throw new Error('redis is down');
            return { ...store.get(key) };
        },
        async exists(key: string) {
            if (failNext) throw new Error('redis is down');
            return store.has(key) ? 1 : 0;
        },
        async hset(key: string, fields: Record<string, string | number>) {
            hset(key, fields);
            return 1;
        },
    };
    return { redisConnection };
});

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    ARCHIVE_TOKEN_PATTERN,
    beginStreaming,
    finishProgress,
    isTerminal,
    readProgress,
    recordProgress,
    requestCancel,
    startProgress,
} = await import('./archiveProgress.service.js');

const TOKEN = 'f7a1c2d4-9e0b-4a11-8c3d-2b6e5f0a7d91';

beforeEach(() => {
    store.clear();
    failNext = false;
});

describe('ARCHIVE_TOKEN_PATTERN', () => {
    it('accepts a crypto.randomUUID, which is what the client sends', () => {
        expect(ARCHIVE_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    });

    it('rejects anything that could reshape the key it is spliced into', () => {
        // The token becomes part of a Redis key and arrives in a form field.
        expect(ARCHIVE_TOKEN_PATTERN.test('archive:progress:other')).toBe(false);
        expect(ARCHIVE_TOKEN_PATTERN.test('short')).toBe(false);
        expect(ARCHIVE_TOKEN_PATTERN.test('a'.repeat(65))).toBe(false);
    });
});

describe('progress lifecycle', () => {
    it('reads back numbers as numbers, not as the strings Redis stores', async () => {
        await startProgress(TOKEN, 40);
        await beginStreaming(TOKEN, { totalItems: 40, totalBytes: 5_000, fileName: 'x.zip' });
        await recordProgress(TOKEN, { completedItems: 12, sentBytes: 1_500 });

        expect(await readProgress(TOKEN)).toEqual({
            status: 'streaming',
            totalItems: 40,
            completedItems: 12,
            totalBytes: 5_000,
            sentBytes: 1_500,
            fileName: 'x.zip',
        });
    });

    it('starts as preparing, so a first poll finds an accepted request', async () => {
        await startProgress(TOKEN, 3);
        // A poll that finds nothing cannot tell a rejected request from one that
        // has not arrived, and can only wait.
        expect(await readProgress(TOKEN)).toMatchObject({ status: 'preparing', totalItems: 3 });
    });

    it('carries the reason a download failed', async () => {
        await startProgress(TOKEN, 3);
        await finishProgress(TOKEN, 'failed', 'None of these items exist');

        expect(await readProgress(TOKEN)).toMatchObject({
            status: 'failed',
            error: 'None of these items exist',
        });
        expect(isTerminal('failed')).toBe(true);
        expect(isTerminal('streaming')).toBe(false);
    });

    it('has nothing to report for a token it has never seen', async () => {
        expect(await readProgress(TOKEN)).toBeNull();
    });
});

describe('cancellation', () => {
    it('reaches the streaming request through its next progress sample', async () => {
        await startProgress(TOKEN, 3);
        expect(await recordProgress(TOKEN, { completedItems: 0, sentBytes: 1 })).toEqual({
            cancelRequested: false,
        });

        expect(await requestCancel(TOKEN)).toBe(true);

        // The request writing the zip is committed to its response and has no other
        // moment to notice, so the answer rides along with the update it was making.
        expect(await recordProgress(TOKEN, { completedItems: 1, sentBytes: 2 })).toEqual({
            cancelRequested: true,
        });
    });

    it('reports a token with no live download, rather than inventing one', async () => {
        expect(await requestCancel(TOKEN)).toBe(false);
    });
});

describe('when Redis is unreachable', () => {
    it('degrades to an unknown readout instead of failing the download', async () => {
        await startProgress(TOKEN, 3);
        failNext = true;

        // Progress is a readout, not part of the transfer: the zip must still be
        // delivered, and nothing here may throw into the streaming path.
        await expect(beginStreaming(TOKEN, {
            totalItems: 3, totalBytes: 1, fileName: 'x.zip',
        })).resolves.toBeUndefined();
        expect(await recordProgress(TOKEN, { completedItems: 1, sentBytes: 1 })).toEqual({
            cancelRequested: false,
        });
        expect(await readProgress(TOKEN)).toBeNull();
        expect(await requestCancel(TOKEN)).toBe(false);
    });
});
