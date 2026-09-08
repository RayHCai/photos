import { Readable, Transform } from 'node:stream';
import type { Response } from 'express';
import { ZipArchive } from 'archiver';
import * as s3Service from './s3.service.js';
import * as archiveProgress from './archiveProgress.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { fireAndForget } from '../utils/async.js';
import { logger } from '../utils/logger.js';

/** One member of the archive: where to read it from, and what to call it inside. */
export interface ArchiveEntry {
    key: string;
    fileName: string;
    /**
     * Size of the original in bytes, used only to give the download a total to
     * count towards. Optional because the archive itself does not need it: an
     * entry with no size still streams, it just leaves the progress readout
     * indeterminate.
     */
    size?: number;
}

/**
 * Ceiling on one archive. Each item costs an S3 GET and its bytes through this
 * process, so an uncapped selection is an uncapped request — and the body carrying
 * the ids is capped at 1 MB anyway (see createApp), which is a few thousand.
 */
export const MAX_ARCHIVE_ITEMS = 2000;

/**
 * Read the ids out of a form field.
 *
 * They arrive comma-joined in one field rather than as a JSON array because the
 * request is a form navigation, not a fetch — that is what lets the browser's
 * download manager own the response. One field rather than one input per id: a
 * selection of two thousand would otherwise put two thousand nodes in the
 * document while a tap is being handled.
 */
export function parseArchiveIds(raw: unknown): string[] {
    const ids = [
        ...new Set(
            String(raw ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean)
        ),
    ];

    if (ids.length === 0) throw new AppError(400, 'No items requested');
    if (ids.length > MAX_ARCHIVE_ITEMS) {
        throw new AppError(400, `Cannot archive more than ${MAX_ARCHIVE_ITEMS} items at once`);
    }
    return ids;
}

/** Names the file the user ends up with, so it is obvious what a stray zip holds. */
export function archiveFileName(count: number, now = new Date()): string {
    return `photos-${now.toISOString().slice(0, 10)}-${count}-items.zip`;
}

/**
 * Photos and videos are already compressed, so deflate would spend CPU on every
 * byte to save almost none. STORE frames them and copies them through.
 *
 * `forceZip64` because sizes are not known ahead of a streamed entry: without it
 * the writer commits to 32-bit fields and any single original over 4 GB — a long
 * 4K video — would be written with a truncated size that no unpacker can read.
 */
const ZIP_OPTIONS = { store: true, forceZip64: true } as const;

/**
 * Make every name in the archive unique.
 *
 * Two library items are allowed to share a file name (two cameras both producing
 * IMG_0001.jpg, the same photo uploaded from two devices). A zip can hold
 * duplicate names, but unpacking it silently keeps one of them, so a 40-file
 * archive would quietly extract as 38.
 */
export function uniqueNames(entries: ArchiveEntry[]): ArchiveEntry[] {
    const seen = new Map<string, number>();
    return entries.map((entry) => {
        const lower = entry.fileName.toLowerCase();
        const count = seen.get(lower) ?? 0;
        seen.set(lower, count + 1);
        if (count === 0) return entry;

        const dot = entry.fileName.lastIndexOf('.');
        const stem = dot > 0 ? entry.fileName.slice(0, dot) : entry.fileName;
        const ext = dot > 0 ? entry.fileName.slice(dot) : '';
        return { ...entry, fileName: `${stem} (${count})${ext}` };
    });
}

/**
 * Read one object, yielding nothing if it cannot be read.
 *
 * Wrapped in a generator so the S3 GET is not issued until the archiver actually
 * reaches this entry: `Readable.from` does not start the generator body until the
 * first read. Opening every object up front would leave dozens of S3 connections
 * idle in the queue, and the ones at the back would time out before their turn.
 *
 * A failure here must not reject. Headers are long gone by the time most of these
 * run, so there is no status code left to send — throwing would abort the archiver
 * and hand the user a truncated zip with no explanation. One unreadable object
 * becomes one empty entry, which is visible in the archive, and the rest of the
 * selection still arrives.
 */
async function* readObject(entry: ArchiveEntry) {
    let stream: Readable;
    try {
        stream = await s3Service.getObjectStream(entry.key);
    }
    catch (err) {
        logger.error({ err, key: entry.key }, 'archive entry could not be opened');
        return;
    }

    try {
        for await (const chunk of stream) yield chunk;
    }
    catch (err) {
        logger.error({ err, key: entry.key }, 'archive entry failed mid-read');
    }
}

/**
 * Expected size of the payload, which is what the progress readout counts
 * towards.
 *
 * The zip framing adds a little on top of this (a local header and a central
 * directory record per entry) and an unreadable object subtracts its whole
 * contribution, so treat it as an estimate — on photo and video originals both
 * errors are a rounding difference. Zero means no size was known for anything,
 * which the client renders as indeterminate rather than as an empty bar.
 */
export function estimateArchiveBytes(entries: ArchiveEntry[]): number {
    return entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
}

/** How often progress is published while bytes are moving. */
const PROGRESS_INTERVAL_MS = 500;

/**
 * Stream a zip of `entries` to the response as an attachment.
 *
 * Deliberately a stream with no Content-Length. The alternative — build the
 * archive, measure it, then send — needs the whole selection in memory or on disk
 * before the first byte moves, which is what made the browser-side version of
 * this unusable (a 150-photo batch peaked near 1.5 GB). The cost is that the
 * browser can only show an indeterminate progress bar, since it cannot know the
 * total in advance — which is what `progressToken` is for: the sizes are known
 * here, so the app reports the real figure itself (see archiveProgress.service).
 *
 * The response is the archive, so once the first byte is written there is no way
 * to report a failure except by ending the stream. Everything that can fail per
 * entry is therefore handled in readObject instead of thrown.
 */
export async function streamArchive(
    res: Response,
    entries: ArchiveEntry[],
    archiveName: string,
    progressToken?: string | null
): Promise<void> {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', s3Service.contentDisposition(archiveName));
    // An archive is assembled per request from whatever was selected; nothing
    // about it is reusable, and it must never be served to a later request.
    res.setHeader('Cache-Control', 'no-store');
    // Chrome buffers a download it cannot type-sniff; this says not to try.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const archive = new ZipArchive(ZIP_OPTIONS);

    let sentBytes = 0;
    let completedItems = 0;
    /** Set once the archive has been torn down, so teardown only runs once. */
    let stopped = false;
    let lastPublishAt = 0;
    let publishInFlight = false;

    /**
     * Resolves when the archive is torn down, which is the only way some teardowns
     * become observable — see the race below finalize().
     */
    let markStopped: () => void;
    const stoppedSignal = new Promise<void>((resolve) => {
        markStopped = resolve;
    });

    // Captured as a const so its narrowing survives into the callbacks below.
    const token = progressToken ?? null;

    const stop = (status: archiveProgress.ArchiveProgressStatus, error?: string) => {
        if (stopped) return;
        stopped = true;
        archive.abort();
        if (token) {
            fireAndForget(
                () => archiveProgress.finishProgress(token, status, error),
                (err) => logger.warn({ err, archiveName }, 'archive: final status not recorded')
            );
        }
        res.destroy();
        markStopped();
    };

    /**
     * Publish a sample, at most one every PROGRESS_INTERVAL_MS and never two at
     * once — this is called per chunk off the socket, which for a large selection
     * is tens of thousands of times.
     *
     * The reply carries the answer to "has the user cancelled", because a request
     * already streaming its response has no other moment to find out. See
     * archiveProgress.recordProgress.
     */
    const publishProgress = () => {
        if (!token || stopped || publishInFlight) return;
        const now = Date.now();
        if (now - lastPublishAt < PROGRESS_INTERVAL_MS) return;
        lastPublishAt = now;
        publishInFlight = true;
        fireAndForget(
            async () => {
                try {
                    const { cancelRequested } = await archiveProgress.recordProgress(token, {
                        completedItems,
                        sentBytes,
                    });
                    if (cancelRequested) {
                        logger.info({ archiveName }, 'archive cancelled by client');
                        stop('cancelled');
                    }
                }
                finally {
                    publishInFlight = false;
                }
            },
            (err) => logger.warn({ err, archiveName }, 'archive: progress sample not published')
        );
    };

    /**
     * Counts the bytes on their way to the socket.
     *
     * A pass-through rather than archiver's own `progress` event, which only fires
     * as each entry completes: one 4 GB video would otherwise sit at the same
     * percentage for minutes. Chunk sizes here are what the client actually
     * receives, so this measures the download rather than the read from S3.
     */
    const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            sentBytes += chunk.length;
            publishProgress();
            callback(null, chunk);
        },
    });

    archive.on('warning', (err) => {
        // ENOENT here is a missing entry, which readObject has already logged and
        // absorbed; anything else is worth seeing.
        logger.warn({ err, archiveName }, 'archive warning');
    });
    archive.on('error', (err) => {
        logger.error({ err, archiveName }, 'archive failed');
        stop('failed', 'Archive failed');
    });
    archive.on('progress', (data: { entries: { processed: number } }) => {
        completedItems = data.entries.processed;
    });

    /**
     * A user who taps Cancel, backgrounds the app, or loses signal leaves this
     * request half-served. Without this the archiver keeps pulling objects out of
     * S3 and writing into a socket nobody is reading — paying full egress for a
     * download that ended minutes ago.
     */
    res.on('close', () => {
        if (!res.writableEnded) {
            logger.info({ archiveName }, 'archive aborted by client');
            stop('cancelled');
        }
    });

    archive.pipe(counter).pipe(res);

    if (token) {
        await archiveProgress.beginStreaming(token, {
            totalItems: entries.length,
            totalBytes: estimateArchiveBytes(entries),
            fileName: archiveName,
        });
    }

    for (const entry of uniqueNames(entries)) {
        archive.append(Readable.from(readObject(entry)), { name: entry.fileName });
    }

    /**
     * Raced against teardown rather than simply awaited.
     *
     * archiver settles finalize() on its output module emitting `end`, and an abort
     * mid-stream destroys that module without ever ending it — so on a cancelled or
     * disconnected download the promise never settles, and awaiting it alone parks
     * this request handler, and everything it has open, for the life of the process.
     * (Only an abort raised *before* finalize is called rejects promptly.)
     */
    const finalized: Promise<unknown> = archive
        .finalize()
        .then(() => null)
        .catch((err: unknown) => err ?? new Error('archive aborted'));

    const failure = await Promise.race([finalized, stoppedSignal.then(() => null)]);

    // Teardown has already published its own terminal status — cancelled by the
    // user, dropped by the client, or a failure the error handler above reported.
    if (stopped) return;

    if (failure) {
        logger.error({ err: failure, archiveName }, 'archive could not be finalized');
        stop('failed', 'Archive failed');
        return;
    }

    if (token) {
        // The last sample is likely a throttle interval behind, and the panel
        // should not settle on "38 of 40".
        await archiveProgress.recordProgress(token, {
            completedItems: entries.length,
            sentBytes,
        });
        await archiveProgress.finishProgress(token, 'completed');
    }
    logger.info({ archiveName, count: entries.length }, 'archive complete');
}
