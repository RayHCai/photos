import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import type { Response } from 'express';

/**
 * S3 and the logger are stubbed rather than configured. Reaching the real ones pulls
 * in config/env, which refuses to load without a database URL and AWS credentials —
 * so an unmocked import here would make the suite depend on a populated .env and
 * fail in CI, where there is none.
 */
const OBJECTS: Record<string, string> = {
    'originals/one.jpg': 'AAAA-bytes-of-photo-one',
    'originals/two.jpg': 'BBBB-bytes-of-photo-two',
};

vi.mock('./s3.service.js', () => ({
    getObjectStream: async (key: string) => {
        const body = OBJECTS[key];
        if (body === undefined) throw new Error('NoSuchKey');
        return Readable.from([Buffer.from(body)]);
    },
    contentDisposition: (fileName: string) => `attachment; filename="${fileName}"`,
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Stubbed for the same reason as s3: the real one opens a Redis connection at
 * import time, by way of config/env. It is also what lets these tests read the
 * progress an archive reported without running a Redis.
 */
vi.mock('./archiveProgress.service.js', () => ({
    beginStreaming: vi.fn(async () => {}),
    recordProgress: vi.fn(async () => ({ cancelRequested: false })),
    finishProgress: vi.fn(async () => {}),
}));

const {
    streamArchive,
    uniqueNames,
    parseArchiveIds,
    archiveFileName,
    estimateArchiveBytes,
    MAX_ARCHIVE_ITEMS,
} = await import('./archive.service.js');
const progress = vi.mocked(await import('./archiveProgress.service.js'));

/** Local file header, and end of central directory. */
const LOCAL_FILE_HEADER = '504b0304';
const END_OF_CENTRAL_DIRECTORY = '504b0506';

/** A Response that is just a stream, which is all streamArchive treats it as. */
function fakeResponse() {
    const sink = new PassThrough();
    const headers = new Map<string, string>();
    const res = Object.assign(sink, {
        setHeader: (key: string, value: string) => headers.set(key, value),
    }) as unknown as Response;
    return { res, sink, headers };
}

async function collect(sink: PassThrough): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of sink) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

describe('parseArchiveIds', () => {
    it('splits a comma-joined form field, trimming and dropping blanks', () => {
        expect(parseArchiveIds(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    });

    it('drops duplicates, so one id cannot be archived twice', () => {
        expect(parseArchiveIds('a,b,a')).toEqual(['a', 'b']);
    });

    it('rejects an empty selection rather than streaming an empty zip', () => {
        expect(() => parseArchiveIds('')).toThrow('No items requested');
        expect(() => parseArchiveIds(undefined)).toThrow('No items requested');
        expect(() => parseArchiveIds(',,')).toThrow('No items requested');
    });

    it('rejects a selection past the cap', () => {
        const ids = Array.from({ length: MAX_ARCHIVE_ITEMS + 1 }, (_, i) => `id-${i}`);
        expect(() => parseArchiveIds(ids.join(','))).toThrow(/more than/);
    });

    it('accepts a selection exactly at the cap', () => {
        const ids = Array.from({ length: MAX_ARCHIVE_ITEMS }, (_, i) => `id-${i}`);
        expect(parseArchiveIds(ids.join(','))).toHaveLength(MAX_ARCHIVE_ITEMS);
    });
});

describe('uniqueNames', () => {
    it('suffixes a repeated name before its extension', () => {
        expect(
            uniqueNames([
                { key: 'a', fileName: 'IMG_0001.jpg' },
                { key: 'b', fileName: 'IMG_0001.jpg' },
                { key: 'c', fileName: 'IMG_0001.jpg' },
            ]).map((e) => e.fileName)
        ).toEqual(['IMG_0001.jpg', 'IMG_0001 (1).jpg', 'IMG_0001 (2).jpg']);
    });

    it('treats names differing only in case as the same', () => {
        // Extracting onto a case-insensitive filesystem would collapse them.
        expect(
            uniqueNames([
                { key: 'a', fileName: 'photo.JPG' },
                { key: 'b', fileName: 'photo.jpg' },
            ]).map((e) => e.fileName)
        ).toEqual(['photo.JPG', 'photo (1).jpg']);
    });

    it('appends to the end when there is no extension', () => {
        expect(
            uniqueNames([
                { key: 'a', fileName: 'noext' },
                { key: 'b', fileName: 'noext' },
            ]).map((e) => e.fileName)
        ).toEqual(['noext', 'noext (1)']);
    });

    it('leaves a set of distinct names untouched', () => {
        const entries = [
            { key: 'a', fileName: 'one.jpg' },
            { key: 'b', fileName: 'two.jpg' },
        ];
        expect(uniqueNames(entries)).toEqual(entries);
    });
});

describe('archiveFileName', () => {
    it('names the archive by date and count', () => {
        expect(archiveFileName(3, new Date('2026-08-15T10:00:00Z')))
            .toBe('photos-2026-08-15-3-items.zip');
    });
});

describe('streamArchive', () => {
    it('sends the response as an attachment that is never cached', async () => {
        const { res, sink, headers } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(res, [{ key: 'originals/one.jpg', fileName: 'one.jpg' }], 'x.zip');
        await bytes;

        expect(headers.get('Content-Type')).toBe('application/zip');
        expect(headers.get('Content-Disposition')).toContain('attachment');
        expect(headers.get('Content-Disposition')).toContain('x.zip');
        // The bytes are assembled per request from an arbitrary selection; a cached
        // copy would be served for a different one.
        expect(headers.get('Cache-Control')).toBe('no-store');
    });

    it('writes a zip whose framing an unpacker can read', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(
            res,
            [
                { key: 'originals/one.jpg', fileName: 'one.jpg' },
                { key: 'originals/two.jpg', fileName: 'two.jpg' },
            ],
            'x.zip'
        );
        const buf = await bytes;

        expect(buf.subarray(0, 4).toString('hex')).toBe(LOCAL_FILE_HEADER);
        // Without a central directory at the end there is no index, and an archive
        // with no index is not a zip — this is what a truncated response looks like.
        expect(buf.toString('hex')).toContain(END_OF_CENTRAL_DIRECTORY);
        expect(buf.toString('latin1')).toContain('one.jpg');
        expect(buf.toString('latin1')).toContain('two.jpg');
    });

    it('stores rather than compresses, so photo bytes pass through verbatim', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(res, [{ key: 'originals/one.jpg', fileName: 'one.jpg' }], 'x.zip');
        const buf = await bytes;

        // Deflating already-compressed photos costs CPU per byte and saves nothing.
        expect(buf.toString('latin1')).toContain('AAAA-bytes-of-photo-one');
    });

    it('keeps going when one object cannot be read', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(
            res,
            [
                { key: 'originals/one.jpg', fileName: 'one.jpg' },
                { key: 'originals/deleted.jpg', fileName: 'gone.jpg' },
                { key: 'originals/two.jpg', fileName: 'two.jpg' },
            ],
            'x.zip'
        );
        const buf = await bytes;

        // The alternative is aborting mid-stream, which hands the user a truncated
        // zip: one deleted photo would cost them the whole selection.
        expect(buf.toString('latin1')).toContain('AAAA-bytes-of-photo-one');
        expect(buf.toString('latin1')).toContain('BBBB-bytes-of-photo-two');
        expect(buf.toString('hex')).toContain(END_OF_CENTRAL_DIRECTORY);
    });

    it('renames duplicates on the way in, so every entry survives extraction', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(
            res,
            [
                { key: 'originals/one.jpg', fileName: 'IMG_0001.jpg' },
                { key: 'originals/two.jpg', fileName: 'IMG_0001.jpg' },
            ],
            'x.zip'
        );
        const buf = await bytes;

        expect(buf.toString('latin1')).toContain('IMG_0001.jpg');
        expect(buf.toString('latin1')).toContain('IMG_0001 (1).jpg');
    });
});

describe('estimateArchiveBytes', () => {
    it('sums the entry sizes', () => {
        expect(
            estimateArchiveBytes([
                { key: 'a', fileName: 'a.jpg', size: 1000 },
                { key: 'b', fileName: 'b.jpg', size: 2500 },
            ])
        ).toBe(3500);
    });

    it('is zero when no size is known, which the client reads as indeterminate', () => {
        // An entry with no size still archives; it just cannot be counted.
        expect(estimateArchiveBytes([{ key: 'a', fileName: 'a.jpg' }])).toBe(0);
    });
});

describe('streamArchive progress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(progress.recordProgress).mockResolvedValue({ cancelRequested: false });
    });

    const ENTRIES = [
        { key: 'originals/one.jpg', fileName: 'one.jpg', size: 23 },
        { key: 'originals/two.jpg', fileName: 'two.jpg', size: 23 },
    ];

    it('publishes the totals the panel counts towards, then a terminal status', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(res, ENTRIES, 'x.zip', 'token-abcdefgh');
        await bytes;

        expect(progress.beginStreaming).toHaveBeenCalledWith('token-abcdefgh', {
            totalItems: 2,
            totalBytes: 46,
            fileName: 'x.zip',
        });
        // The last sample the throttle produced is generally a beat behind, so the
        // panel would otherwise settle on "1 of 2" for a download that finished.
        expect(progress.recordProgress).toHaveBeenLastCalledWith('token-abcdefgh', {
            completedItems: 2,
            sentBytes: expect.any(Number),
        });
        expect(progress.finishProgress).toHaveBeenCalledWith('token-abcdefgh', 'completed');
    });

    it('reports bytes as they reach the socket, not as entries finish', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(res, ENTRIES, 'x.zip', 'token-abcdefgh');
        const buf = await bytes;

        // A single large video would otherwise sit at one percentage for minutes.
        const [, firstSample] = vi.mocked(progress.recordProgress).mock.calls[0]!;
        expect(firstSample.sentBytes).toBeGreaterThan(0);
        expect(firstSample.sentBytes).toBeLessThanOrEqual(buf.length);
    });

    it('says nothing when no token was supplied', async () => {
        const { res, sink } = fakeResponse();
        const bytes = collect(sink);

        await streamArchive(res, ENTRIES, 'x.zip');
        await bytes;

        expect(progress.beginStreaming).not.toHaveBeenCalled();
        expect(progress.recordProgress).not.toHaveBeenCalled();
        expect(progress.finishProgress).not.toHaveBeenCalled();
    });

    it('tears the archive down when the client has asked to cancel', async () => {
        vi.mocked(progress.recordProgress).mockResolvedValue({ cancelRequested: true });
        const { res, sink } = fakeResponse();
        // The response is destroyed rather than ended, so the sink errors — that
        // truncation is the cancel, and is the only signal the protocol has here.
        sink.on('error', () => {});

        await streamArchive(res, ENTRIES, 'x.zip', 'token-abcdefgh');

        expect(progress.finishProgress).toHaveBeenCalledWith(
            'token-abcdefgh',
            'cancelled',
            undefined
        );
        expect(sink.destroyed).toBe(true);
    });
});
