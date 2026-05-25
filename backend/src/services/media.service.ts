import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as personsService from './persons.service.js';
import * as s3Service from './s3.service.js';
import * as queueService from './queue.service.js';
import { logger } from '../utils/logger.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';
import { HIDDEN_EXCLUSION, HIDDEN_NOT_EXISTS } from '../utils/filters.js';
import { collectS3Keys } from '../utils/s3.js';


const SUPPORTED_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/tiff',
    'image/avif',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-matroska',
]);

function getMediaType(mimeType: string): 'PHOTO' | 'VIDEO' {
    return mimeType.startsWith('video/') ? 'VIDEO' : 'PHOTO';
}

function getExtension(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop()! : 'bin';
}

export function validateMimeType(mimeType: string) {
    if (!SUPPORTED_MIMES.has(mimeType)) {
        throw new AppError(400, `Unsupported file type: ${mimeType}`);
    }
}

type StartStage = 'full' | 'clip' | 'faces' | 'blurhash' | 'transcode' | 'web' | 'metadata';

async function _createTaskAndEnqueue(
    mediaItemId: string,
    originalKey: string,
    mimeType: string,
    type: 'PHOTO' | 'VIDEO',
    startStage: StartStage = 'full',
) {
    const taskId = randomUUID();
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { currentTaskId: taskId, processingStatus: 'PENDING', processingError: null },
    });
    await queueService.enqueueMediaProcessing({ mediaItemId, taskId, originalKey, mimeType, type, startStage });
    logger.info({ mediaItemId, taskId, type, startStage }, 'media: processing task enqueued');
}

async function _queryAndEnqueue(
    where: Prisma.MediaItemWhereInput,
    startStage: StartStage,
    logLabel: string,
): Promise<number> {
    const items = await prisma.mediaItem.findMany({
        where,
        select: { id: true, originalKey: true, mimeType: true, type: true },
    });
    for (const item of items) {
        await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type, startStage);
    }
    logger.info({ count: items.length }, `media: ${logLabel}`);
    return items.length;
}

export async function createPresignedUpload(
    fileName: string,
    mimeType: string,
    fileSize: number
) {
    validateMimeType(mimeType);

    const ext = getExtension(fileName);
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

export async function confirmPresignedUpload(mediaItemId: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({ where: { id: mediaItemId } }),
        'Media item'
    );
    await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type);
    return item;
}

export async function initMultipartUpload(
    fileName: string,
    mimeType: string,
    fileSize: number
) {
    validateMimeType(mimeType);

    const ext = getExtension(fileName);
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
    parts: Array<{ PartNumber: number; ETag: string }>
) {
    await s3Service.completeMultipartUpload(s3Key, uploadId, parts);

    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({ where: { id: mediaItemId } }),
        'Media item'
    );
    await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type);
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

export async function getShellData() {
    return prisma.mediaItem.findMany({
        where: HIDDEN_EXCLUSION,
        orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: MEDIA_ITEM_SUMMARY_SELECT,
    });
}

export async function getTimeline() {
    const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(COALESCE("taken_at", "created_at"), 'YYYY-MM') AS month,
               COUNT(*)::bigint AS count
        FROM "media_items" m
        WHERE ${HIDDEN_NOT_EXISTS}
        GROUP BY month
        ORDER BY month DESC
    `;
    return rows.map((r) => ({ month: r.month, count: Number(r.count) }));
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
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({ where: { id } }),
        'Media item'
    );

    const personIds = await personsService.getAffectedPersonIds(id);
    const keysToDelete = collectS3Keys(item);

    logger.info({ mediaId: id, s3Keys: keysToDelete.length }, 'media: deleting item and S3 objects');
    await Promise.all([
        s3Service.deleteObjects(keysToDelete),
        prisma.mediaItem.delete({ where: { id } }),
    ]);
    logger.info({ mediaId: id }, 'media: item deleted');

    await personsService.cleanupOrphanPersons(personIds, 'media delete');
}

export async function batchDeleteMedia(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, originalKey: true, thumbnailKey: true, streamingKey: true, webKey: true },
    });

    const personIds = await personsService.getAffectedPersonIds(ids);
    const keysToDelete = items.flatMap(collectS3Keys);

    logger.info({ requested: ids.length, found: items.length, s3Keys: keysToDelete.length }, 'media: batch deleting');
    await Promise.all([
        s3Service.deleteObjects(keysToDelete),
        prisma.mediaItem.deleteMany({ where: { id: { in: ids } } }),
    ]);
    logger.info({ deleted: items.length }, 'media: batch delete completed');

    await personsService.cleanupOrphanPersons(personIds, 'batch delete');

    return items.length;
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

    return s3Service.getMediaUrl(item.thumbnailKey);
}

export async function getBatchThumbnailUrls(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids }, thumbnailKey: { not: null } },
        select: { id: true, thumbnailKey: true },
    });

    const entries = await Promise.all(
        items.map(async (item) => {
            const url = await s3Service.getMediaUrl(item.thumbnailKey!);
            return [item.id, url] as const;
        })
    );

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
    return s3Service.getPresignedDownloadUrl(key);
}

export async function getWebUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { webKey: true, originalKey: true, streamingKey: true, type: true },
        }),
        'Media item'
    );
    // For videos, use streaming key; for photos, prefer web key, fall back to original
    if (item.type === 'VIDEO') {
        const key = item.streamingKey ?? item.originalKey;
        return s3Service.getPresignedDownloadUrl(key);
    }
    // Serve web-optimized photos via CDN when available
    if (item.webKey) {
        return s3Service.getMediaUrl(item.webKey);
    }
    return s3Service.getPresignedDownloadUrl(item.originalKey);
}

export async function getDownloadUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { originalKey: true, fileName: true },
        }),
        'Media item'
    );
    return s3Service.getPresignedDownloadUrl(item.originalKey, item.fileName);
}

export async function checkDuplicateFileNames(fileNames: string[]) {
    const existing = await prisma.mediaItem.findMany({
        where: { fileName: { in: fileNames } },
        select: { id: true, fileName: true, thumbnailKey: true, originalKey: true },
    });

    // Verify S3 objects exist; delete orphan DB records for failed uploads
    const verified: typeof existing = [];
    const orphanIds: string[] = [];

    await Promise.all(
        existing.map(async (item) => {
            const exists = await s3Service.objectExists(item.originalKey);
            if (exists) {
                verified.push(item);
            } else {
                orphanIds.push(item.id);
            }
        })
    );

    if (orphanIds.length > 0) {
        await prisma.mediaItem.deleteMany({ where: { id: { in: orphanIds } } });
        logger.info({ count: orphanIds.length }, 'media: cleaned up orphan records with missing S3 objects');
    }

    return verified.map(({ originalKey: _, ...rest }) => rest);
}

export async function retryAllFailed() {
    return _queryAndEnqueue({ processingStatus: 'FAILED' }, 'full', 'retried all failed items');
}

export async function batchRetryMedia(ids: string[]) {
    return _queryAndEnqueue(
        { id: { in: ids }, processingStatus: { in: ['FAILED', 'PENDING'] } },
        'full',
        'batch retry completed',
    );
}

export async function enqueueAllPending() {
    return _queryAndEnqueue({ processingStatus: 'PENDING' }, 'full', 'enqueued all pending items');
}

export async function backfillBlurHashes() {
    return _queryAndEnqueue({ blurHash: null, processingStatus: 'COMPLETED' }, 'blurhash', 'blurhash backfill enqueued');
}

export async function backfillAllMissingBlurHashes() {
    return _queryAndEnqueue({ blurHash: null, thumbnailKey: { not: null } }, 'blurhash', 'backfill ALL missing blurhashes enqueued');
}

export async function rerunMissingFaces() {
    return _queryAndEnqueue({ processingStatus: 'COMPLETED', faces: { none: {} } }, 'faces', 'rerun missing faces enqueued');
}

export async function fixOrphanedProcessing() {
    const result = await prisma.mediaItem.updateMany({
        where: {
            processingStatus: 'PROCESSING',
            thumbnailKey: { not: null },
            blurHash: { not: null },
        },
        data: {
            processingStatus: 'COMPLETED',
            processingError: null,
        },
    });

    logger.info({ count: result.count }, 'media: orphaned PROCESSING items fixed to COMPLETED');
    return result.count;
}

export async function backfillTranscoding() {
    return _queryAndEnqueue({ type: 'VIDEO', streamingKey: null, processingStatus: 'COMPLETED' }, 'transcode', 'transcode backfill enqueued');
}

export async function backfillWebOptimized() {
    return _queryAndEnqueue({ type: 'PHOTO', webKey: null, processingStatus: 'COMPLETED' }, 'web', 'web-optimized backfill enqueued');
}

export async function backfillMetadata() {
    return _queryAndEnqueue(
        { processingStatus: 'COMPLETED', latitude: null },
        'metadata',
        'metadata backfill enqueued',
    );
}
