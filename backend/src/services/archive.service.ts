import { Readable } from 'node:stream';
import type { Response } from 'express';
import { ZipArchive } from 'archiver';
import * as s3Service from './s3.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/** One member of the archive: where to read it from, and what to call it inside. */
export interface ArchiveEntry {
    key: string;
    fileName: string;
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
 * Stream a zip of `entries` to the response as an attachment.
 *
 * Deliberately a stream with no Content-Length. The alternative — build the
 * archive, measure it, then send — needs the whole selection in memory or on disk
 * before the first byte moves, which is what made the browser-side version of
 * this unusable (a 150-photo batch peaked near 1.5 GB). The cost is that the
 * browser shows an indeterminate progress bar, since it cannot know the total in
 * advance.
 *
 * The response is the archive, so once the first byte is written there is no way
 * to report a failure except by ending the stream. Everything that can fail per
 * entry is therefore handled in readObject instead of thrown.
 */
export async function streamArchive(
    res: Response,
    entries: ArchiveEntry[],
    archiveName: string
): Promise<void> {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', s3Service.contentDisposition(archiveName));
    // An archive is assembled per request from whatever was selected; nothing
    // about it is reusable, and it must never be served to a later request.
    res.setHeader('Cache-Control', 'no-store');
    // Chrome buffers a download it cannot type-sniff; this says not to try.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const archive = new ZipArchive(ZIP_OPTIONS);

    archive.on('warning', (err) => {
        // ENOENT here is a missing entry, which readObject has already logged and
        // absorbed; anything else is worth seeing.
        logger.warn({ err, archiveName }, 'archive warning');
    });
    archive.on('error', (err) => {
        logger.error({ err, archiveName }, 'archive failed');
        res.destroy();
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
            archive.abort();
        }
    });

    archive.pipe(res);

    for (const entry of uniqueNames(entries)) {
        archive.append(Readable.from(readObject(entry)), { name: entry.fileName });
    }

    await archive.finalize();
    logger.info({ archiveName, count: entries.length }, 'archive complete');
}
