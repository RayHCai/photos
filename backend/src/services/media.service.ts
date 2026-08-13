import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { redisConnection } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import * as personsService from './persons.service.js';
import * as s3Service from './s3.service.js';
import * as queueService from './queue.service.js';
import { logger } from '../utils/logger.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { mapWithConcurrency } from '../utils/async.js';
import { MEDIA_ITEM_SUMMARY_SELECT, MEDIA_ITEM_SHELL_SELECT } from '../utils/select.js';
import { HIDDEN_EXCLUSION, HIDDEN_NOT_EXISTS } from '../utils/filters.js';
import { collectMediaS3Keys, MEDIA_S3_KEY_SELECT } from '../utils/s3.js';
import { isSupportedMimeType } from '../constants/mediaFormats.js';
import { safeExtension } from '../constants/storage.js';
import type { PipelineStage } from '../constants/pipeline.js';


function getMediaType(mimeType: string): 'PHOTO' | 'VIDEO' {
    return mimeType.startsWith('video/') ? 'VIDEO' : 'PHOTO';
}

export function validateMimeType(mimeType: string) {
    if (!isSupportedMimeType(mimeType)) {
        throw new AppError(400, `Unsupported file type: ${mimeType}`);
    }
}

export function validateFileSize(fileSize: number) {
    // MAX_FILE_SIZE_MB was declared in env.ts and never referenced anywhere, so
    // nothing bounded an upload server-side: a client could presign a 500 GB PUT.
    const maxBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (fileSize > maxBytes) {
        throw new AppError(
            413,
            `File exceeds the ${env.MAX_FILE_SIZE_MB} MB limit`
        );
    }
}

async function _createTaskAndEnqueue(
    mediaItemId: string,
    originalKey: string,
    mimeType: string,
    type: 'PHOTO' | 'VIDEO',
    startStage: PipelineStage = 'full',
    requestId?: string,
) {
    const taskId = randomUUID();
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { currentTaskId: taskId, processingStatus: 'PENDING', processingError: null },
    });
    await queueService.enqueueMediaProcessing({
        mediaItemId,
        taskId,
        originalKey,
        mimeType,
        type,
        startStage,
        ...(requestId ? { requestId } : {}),
    });
    logger.info({ mediaItemId, taskId, type, startStage }, 'media: processing task enqueued');
}

const BULK_ENQUEUE_PAGE_SIZE = 500;

/**
 * Page through matching rows and enqueue them in bulk.
 *
 * The previous implementation did an unbounded `findMany` and then, per item, a
 * separate UPDATE and a separate queue `add`, strictly serialized, only
 * responding after the whole loop. At 500k items that is ~1M sequential round
 * trips: the client and load balancer time out long before it finishes while the
 * loop keeps running. Callers now invoke this from a background job and get a
 * 202 immediately.
 */
export async function queryAndEnqueue(
    where: Prisma.MediaItemWhereInput,
    startStage: PipelineStage,
    logLabel: string,
): Promise<number> {
    let cursor: string | undefined;
    let total = 0;

    for (;;) {
        const page = await prisma.mediaItem.findMany({
            where,
            select: { id: true, originalKey: true, mimeType: true, type: true },
            orderBy: { id: 'asc' },
            take: BULK_ENQUEUE_PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (page.length === 0) break;

        const jobs = page.map((item) => ({
            mediaItemId: item.id,
            taskId: randomUUID(),
            originalKey: item.originalKey,
            mimeType: item.mimeType,
            type: item.type,
            startStage,
        }));

        // One UPDATE for the whole page instead of one per item. Task ids are
        // assigned per row via a CASE so a superseded task is still detectable.
        await prisma.$transaction(
            jobs.map((job) =>
                prisma.mediaItem.update({
                    where: { id: job.mediaItemId },
                    data: {
                        currentTaskId: job.taskId,
                        processingStatus: 'PENDING',
                        processingError: null,
                    },
                })
            )
        );

        await queueService.enqueueMediaProcessingBulk(jobs);

        total += page.length;
        cursor = page[page.length - 1]!.id;
        if (page.length < BULK_ENQUEUE_PAGE_SIZE) break;
    }

    logger.info({ count: total }, `media: ${logLabel}`);
    return total;
}

export async function createPresignedUpload(
    fileName: string,
    mimeType: string,
    fileSize: number
) {
    validateMimeType(mimeType);
    validateFileSize(fileSize);

    const ext = safeExtension(fileName);
    const originalKey = s3Service.generateOriginalKey(ext);
    const type = getMediaType(mimeType);

    const presignedUrl = await s3Service.getPresignedUploadUrl(
        originalKey,
        mimeType,
        fileSize
    );

    const mediaItem = await prisma.mediaItem.create({
        data: {
            type,
            originalKey,
            fileName,
            mimeType,
            fileSize,
        },
    });

    return { id: mediaItem.id, presignedUrl, s3Key: originalKey };
}

export async function confirmPresignedUpload(mediaItemId: string, requestId?: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({ where: { id: mediaItemId } }),
        'Media item'
    );
    await _createTaskAndEnqueue(
        item.id, item.originalKey, item.mimeType, item.type, 'full', requestId
    );
    return item;
}

export async function initMultipartUpload(
    fileName: string,
    mimeType: string,
    fileSize: number
) {
    validateMimeType(mimeType);
    validateFileSize(fileSize);

    const ext = safeExtension(fileName);
    const originalKey = s3Service.generateOriginalKey(ext);
    const type = getMediaType(mimeType);

    const uploadId = await s3Service.initMultipartUpload(originalKey, mimeType);

    const mediaItem = await prisma.mediaItem.create({
        data: {
            type,
            originalKey,
            fileName,
            mimeType,
            fileSize,
        },
    });

    return { id: mediaItem.id, uploadId, s3Key: originalKey };
}

export async function getMultipartPartUrl(
    s3Key: string,
    uploadId: string,
    partNumber: number
) {
    const presignedUrl = await s3Service.getPresignedPartUrl(
        s3Key,
        uploadId,
        partNumber
    );
    return { presignedUrl, partNumber };
}

export async function completeMultipartUpload(
    mediaItemId: string,
    s3Key: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
    requestId?: string
) {
    await s3Service.completeMultipartUpload(s3Key, uploadId, parts);

    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({ where: { id: mediaItemId } }),
        'Media item'
    );
    await _createTaskAndEnqueue(
        item.id, item.originalKey, item.mimeType, item.type, 'full', requestId
    );
    return item;
}

export async function listMedia(params: {
    cursor?: string;
    limit: number;
    type?: 'PHOTO' | 'VIDEO';
    sort?: 'date_asc' | 'date_desc';
}) {
    const { cursor, limit, type, sort = 'date_desc' } = params;

    const where: Prisma.MediaItemWhereInput = { ...HIDDEN_EXCLUSION };
    if (type) {
        where.type = type;
    }

    const orderBy: Prisma.MediaItemOrderByWithRelationInput =
        sort === 'date_asc'
            ? { takenAt: { sort: 'asc', nulls: 'last' } }
            : { takenAt: { sort: 'desc', nulls: 'last' } };

    const items = await prisma.mediaItem.findMany({
        where,
        orderBy: [orderBy, { createdAt: 'desc' }],
        take: limit + 1,
        ...applyCursor(cursor),
        select: MEDIA_ITEM_SUMMARY_SELECT,
    });

    return paginateResults(items, limit);
}

/**
 * Hard ceiling on the shell payload.
 *
 * This endpoint used to return the entire table with no `take`: the client could
 * not paint until the whole library had transferred, parsed, grouped, and laid
 * out, and the array was then retained for the session. It is also re-fetched
 * whenever anything is processing. Bounding it keeps first paint O(1) in library
 * size; the timeline counts endpoint supplies total scroll height, and /media
 * cursor pagination supplies the tail.
 */
export const SHELL_PAGE_SIZE = 2000;

export async function getShellData(params: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(params.limit ?? SHELL_PAGE_SIZE, SHELL_PAGE_SIZE);

    const items = await prisma.mediaItem.findMany({
        where: HIDDEN_EXCLUSION,
        orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit + 1,
        ...applyCursor(params.cursor),
        select: MEDIA_ITEM_SHELL_SELECT,
    });

    return paginateResults(items, limit);
}

/**
 * Narrow status feed for the processing poll.
 *
 * The client used to poll the entire shell payload every 5 seconds while any
 * item was PENDING/PROCESSING, so one stuck row meant every open tab
 * re-downloaded and re-laid-out the whole library indefinitely.
 */
export async function getProcessingUpdates(since?: Date) {
    const items = await prisma.mediaItem.findMany({
        where: {
            ...HIDDEN_EXCLUSION,
            ...(since ? { updatedAt: { gt: since } } : {}),
        },
        orderBy: { updatedAt: 'asc' },
        take: 500,
        select: {
            id: true,
            processingStatus: true,
            thumbnailKey: true,
            blurHash: true,
            width: true,
            height: true,
            durationSeconds: true,
            takenAt: true,
            updatedAt: true,
        },
    });

    const pendingCount = await prisma.mediaItem.count({
        where: { ...HIDDEN_EXCLUSION, processingStatus: { in: ['PENDING', 'PROCESSING'] } },
    });

    return {
        items,
        pendingCount,
        cursor: items.length > 0 ? items[items.length - 1]!.updatedAt.toISOString() : null,
    };
}

const TIMELINE_CACHE_KEY = 'timeline:months:v2';
const TIMELINE_CACHE_TTL = 300;

/**
 * Month counts driving the timeline scrollbar.
 *
 * Two fixes here. First, the month key is derived from `taken_at_local` (the
 * camera's wall clock) rather than `taken_at` in UTC: the client groups day
 * headers in local time, so a UTC-derived month key failed to join for items near
 * a day boundary and those markers were positioned from a different basis than
 * their neighbours.
 *
 * Second, it is cached. `GROUP BY to_char(...)` over two columns cannot use a
 * btree index, so this was an unconditional sequential scan plus a correlated
 * NOT EXISTS per row — executed on every gallery mount for a few hundred bytes
 * of output.
 */
export async function getTimeline() {
    const cached = await redisConnection.get(TIMELINE_CACHE_KEY);
    if (cached) {
        return JSON.parse(cached) as Array<{ month: string; count: number }>;
    }

    const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(COALESCE("taken_at_local", "taken_at", "created_at"), 'YYYY-MM') AS month,
               COUNT(*)::bigint AS count
        FROM "media_items" m
        WHERE ${HIDDEN_NOT_EXISTS}
        GROUP BY month
        ORDER BY month DESC
    `;

    const result = rows.map((r) => ({ month: r.month, count: Number(r.count) }));
    await redisConnection.setex(TIMELINE_CACHE_KEY, TIMELINE_CACHE_TTL, JSON.stringify(result));
    return result;
}

export async function invalidateTimelineCache() {
    await redisConnection.del(TIMELINE_CACHE_KEY);
}

export async function getMediaById(id: string) {
    return findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            include: {
                faces: {
                    include: { person: true },
                },
            },
        }),
        'Media item'
    );
}

export async function deleteMedia(id: string) {
    return batchDeleteMedia([id]);
}

/**
 * Delete media rows and their S3 objects.
 *
 * Ordering matters and used to be wrong: the old code ran the S3 delete and the
 * DB delete concurrently in `Promise.all`, so a partial failure either left rows
 * pointing at deleted objects (permanently broken images) or silently orphaned
 * every object for a deleted row.
 *
 * S3 now goes first and its result is checked, because an orphaned object is
 * recoverable (it can be re-deleted) whereas a row whose bytes are gone is not.
 * The DB delete only proceeds for keys S3 confirmed.
 */
export async function batchDeleteMedia(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids } },
        select: MEDIA_S3_KEY_SELECT,
    });

    if (items.length === 0) return 0;

    const personIds = await personsService.getAffectedPersonIds(ids);
    const keysToDelete = items.flatMap(collectMediaS3Keys);

    logger.info(
        { requested: ids.length, found: items.length, s3Keys: keysToDelete.length },
        'media: deleting S3 objects before DB rows'
    );

    const { failedKeys } = await s3Service.deleteObjects(keysToDelete);

    if (failedKeys.length > 0) {
        // Leave the rows in place: the user can retry, and the photo still
        // renders in the meantime. Deleting the row here would strand the bytes.
        logger.error(
            { failed: failedKeys.length, sample: failedKeys.slice(0, 5) },
            'media: S3 deletion failed; aborting DB delete to avoid orphaning objects'
        );
        throw new AppError(502, 'Storage deletion failed; nothing was deleted');
    }

    const deleted = await prisma.mediaItem.deleteMany({ where: { id: { in: ids } } });
    logger.info({ deleted: deleted.count }, 'media: delete completed');

    await personsService.cleanupOrphanPersons(personIds, 'media delete');
    await Promise.all([invalidateTimelineCache(), personsService.invalidatePersonsCache()]);

    return deleted.count;
}

export async function getThumbnailUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { thumbnailKey: true },
        }),
        'Media item'
    );

    if (!item.thumbnailKey) {
        throw new AppError(404, 'Thumbnail not yet available');
    }

    return s3Service.getMediaUrlWithExpiry(item.thumbnailKey);
}

export async function getBatchThumbnailUrls(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids }, thumbnailKey: { not: null } },
        select: { id: true, thumbnailKey: true },
    });

    // Bounded rather than an unbounded Promise.all: in presigned mode each entry
    // is a Redis round trip plus possibly a signing operation, and the route
    // accepts up to 200 ids.
    const entries = await mapWithConcurrency(items, 20, async (item) => {
        const url = await s3Service.getMediaUrl(item.thumbnailKey!);
        return [item.id, url] as const;
    });

    return Object.fromEntries(entries) as Record<string, string>;
}

export async function getOriginalUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { originalKey: true, streamingKey: true, type: true },
        }),
        'Media item'
    );
    const key = (item.type === 'VIDEO' && item.streamingKey) ? item.streamingKey : item.originalKey;
    return s3Service.getPresignedDownloadUrlWithExpiry(key);
}

export async function getWebUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { webKey: true, thumbnailKey: true, originalKey: true, streamingKey: true, type: true },
        }),
        'Media item'
    );
    // For videos, use streaming key; for photos, prefer web key
    if (item.type === 'VIDEO') {
        const key = item.streamingKey ?? item.originalKey;
        return s3Service.getPresignedDownloadUrlWithExpiry(key);
    }
    // Serve web-optimized photos via CDN when available
    if (item.webKey) {
        return s3Service.getMediaUrlWithExpiry(item.webKey);
    }
    // No web variant yet. NEVER serve the raw original to a browser <img>: a
    // HEIC/HEIF/TIFF original is undecodable in Chrome/Firefox (permanent broken
    // image), and a large JPG/PNG original is a multi-MB download for a
    // fit-to-screen view. Fall back to the thumbnail — always a browser-safe
    // WebP — which self-heals once the web variant is generated.
    if (item.thumbnailKey) {
        return s3Service.getMediaUrlWithExpiry(item.thumbnailKey);
    }
    throw new AppError(404, 'Web version not yet available');
}

export async function getDownloadUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { originalKey: true, fileName: true },
        }),
        'Media item'
    );
    return s3Service.getPresignedDownloadUrlWithExpiry(item.originalKey, item.fileName);
}

/** Grace period before a row with no S3 object is considered an abandoned upload. */
const ABANDONED_UPLOAD_GRACE_MS = 60 * 60 * 1000;

/**
 * Report which of these filenames already exist in the library.
 *
 * This function used to be a data-loss hazard. `objectExists` swallowed every
 * exception and returned false, so any transient S3 error — credential rotation,
 * an IAM change, a DNS blip — classified a perfectly good row as an orphan and
 * hard-deleted it, cascading its faces and album membership while leaving the
 * bytes stranded in S3. It also raced live uploads: presign creates the row
 * before the PUT completes, so a concurrent check deleted rows mid-upload.
 *
 * Now: only a *definitive* 404 counts as missing, only rows still PENDING and
 * older than the grace period are eligible for cleanup, and the HEAD fan-out is
 * bounded.
 */
export async function checkDuplicateFileNames(fileNames: string[]) {
    const existing = await prisma.mediaItem.findMany({
        where: { fileName: { in: fileNames } },
        select: {
            id: true,
            fileName: true,
            thumbnailKey: true,
            originalKey: true,
            processingStatus: true,
            createdAt: true,
        },
    });

    const verified: typeof existing = [];
    const orphanIds: string[] = [];
    const cutoff = new Date(Date.now() - ABANDONED_UPLOAD_GRACE_MS);

    await mapWithConcurrency(existing, 10, async (item) => {
        // A COMPLETED item has demonstrably been processed from its S3 object;
        // there is no reason to re-verify it on every upload batch.
        if (item.processingStatus === 'COMPLETED') {
            verified.push(item);
            return;
        }

        const state = await s3Service.getObjectState(item.originalKey);

        if (state === 'exists') {
            verified.push(item);
            return;
        }

        if (state === 'error') {
            // Unknown, not absent. Treat as present: a false duplicate warning is
            // recoverable, deleting someone's photo is not.
            logger.warn(
                { mediaId: item.id },
                'media: could not verify S3 object; treating as present'
            );
            verified.push(item);
            return;
        }

        // state === 'missing'
        const isAbandonedUpload =
            item.processingStatus === 'PENDING' && item.createdAt < cutoff;

        if (isAbandonedUpload) {
            orphanIds.push(item.id);
        }
        else {
            verified.push(item);
        }
    });

    if (orphanIds.length > 0) {
        await prisma.mediaItem.deleteMany({
            // Re-assert the predicate at delete time so a row that started
            // processing during the scan is not caught by a stale decision.
            where: {
                id: { in: orphanIds },
                processingStatus: 'PENDING',
                createdAt: { lt: cutoff },
            },
        });
        logger.info(
            { count: orphanIds.length },
            'media: cleaned up abandoned PENDING uploads with no S3 object'
        );
    }

    return verified.map(({ originalKey: _originalKey, processingStatus: _s, createdAt: _c, ...rest }) => rest);
}

/**
 * Flip rows that have been PROCESSING past the lock duration back to FAILED.
 *
 * The only place an item was marked FAILED was the worker's exception handler,
 * over HTTP — so when the failure *was* the network, or the container was
 * OOM-killed or SIGKILLed, the row stayed PROCESSING forever with a null error.
 * Nothing reconciled it, and each stuck row kept every open client on the
 * processing poll indefinitely.
 */
export async function reapStalledProcessing(staleAfterMs = 30 * 60 * 1000) {
    const cutoff = new Date(Date.now() - staleAfterMs);

    const result = await prisma.mediaItem.updateMany({
        where: {
            processingStatus: 'PROCESSING',
            OR: [{ processingAt: { lt: cutoff } }, { processingAt: null, updatedAt: { lt: cutoff } }],
        },
        data: {
            processingStatus: 'FAILED',
            processingError: 'Processing did not complete (worker stalled or restarted)',
        },
    });

    if (result.count > 0) {
        logger.warn({ count: result.count }, 'media: reaped stalled PROCESSING items');
    }
    return result.count;
}

export async function retryAllFailed() {
    return queryAndEnqueue({ processingStatus: 'FAILED' }, 'full', 'retried all failed items');
}

export async function batchRetryMedia(ids: string[]) {
    return queryAndEnqueue(
        { id: { in: ids }, processingStatus: { in: ['FAILED', 'PENDING'] } },
        'full',
        'batch retry completed',
    );
}

export async function enqueueAllPending() {
    return queryAndEnqueue({ processingStatus: 'PENDING' }, 'full', 'enqueued all pending items');
}

export async function backfillBlurHashes() {
    return queryAndEnqueue({ blurHash: null, processingStatus: 'COMPLETED' }, 'blurhash', 'blurhash backfill enqueued');
}

export async function backfillAllMissingBlurHashes() {
    return queryAndEnqueue({ blurHash: null, thumbnailKey: { not: null } }, 'blurhash', 'backfill ALL missing blurhashes enqueued');
}

export async function rerunMissingFaces() {
    // `faces: { none: {} }` also matches every photo that legitimately contains
    // no people, so this used to re-download and re-run detection over landscapes,
    // food and documents on every run. facesScanned records that detection has
    // already completed for an item.
    return queryAndEnqueue(
        { processingStatus: 'COMPLETED', faces: { none: {} }, facesScanned: false },
        'faces',
        'rerun missing faces enqueued'
    );
}

/**
 * Reconcile rows wedged in PROCESSING.
 *
 * The old implementation flipped them to COMPLETED if they happened to have a
 * thumbnail and a blurhash, which the Settings UI described as "reset back to
 * PENDING" — it did neither for an item that stalled before thumbnailing, so an
 * operator saw "Fixed 0 items" and concluded the job was broken.
 *
 * Now: anything genuinely finished is completed, and anything actually stalled is
 * failed so the normal retry path can pick it up.
 */
export async function fixOrphanedProcessing() {
    const completed = await prisma.mediaItem.updateMany({
        where: {
            processingStatus: 'PROCESSING',
            thumbnailKey: { not: null },
            blurHash: { not: null },
        },
        data: { processingStatus: 'COMPLETED', processingError: null },
    });

    const failed = await reapStalledProcessing();

    logger.info(
        { completed: completed.count, failed },
        'media: orphaned PROCESSING items reconciled'
    );
    return completed.count + failed;
}

export async function backfillTranscoding() {
    return queryAndEnqueue({ type: 'VIDEO', streamingKey: null, processingStatus: 'COMPLETED' }, 'transcode', 'transcode backfill enqueued');
}

export async function backfillWebOptimized() {
    return queryAndEnqueue({ type: 'PHOTO', webKey: null, processingStatus: 'COMPLETED' }, 'web', 'web-optimized backfill enqueued');
}

/**
 * No column tracks whether an item already has its responsive thumbnail ladder
 * (the variants live only in S3, derived from thumbnailKey), so unlike the other
 * backfills this can't scope to "missing" — it re-enqueues every completed photo.
 * Cheap per item (a few small WebP re-encodes), but worth knowing before running
 * it against a large library.
 */
export async function backfillThumbnailLadder() {
    return queryAndEnqueue(
        { type: 'PHOTO', thumbnailKey: { not: null }, processingStatus: 'COMPLETED' },
        'thumbnail-ladder',
        'thumbnail ladder backfill enqueued',
    );
}

export async function backfillMetadata() {
    // Keyed on takenAtLocal rather than latitude: the previous predicate matched
    // every photo without GPS, so items that simply have no location were
    // re-enqueued on every single run, forever.
    return queryAndEnqueue(
        { processingStatus: 'COMPLETED', takenAtLocal: null },
        'metadata',
        'metadata backfill enqueued',
    );
}
