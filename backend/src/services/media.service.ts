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

async function _createTaskAndEnqueue(
    mediaItemId: string,
    originalKey: string,
    mimeType: string,
    type: 'PHOTO' | 'VIDEO',
    startStage: 'full' | 'clip' | 'faces' = 'full',
) {
    const taskId = randomUUID();
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { currentTaskId: taskId },
    });
    await queueService.enqueueMediaProcessing({ mediaItemId, taskId, originalKey, mimeType, type, startStage });
    logger.info({ mediaItemId, taskId, type, startStage }, 'media: processing task enqueued');
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

    const where: Prisma.MediaItemWhereInput = {};
    if (type) {
        where.type = type;
    }

    const orderBy: Prisma.MediaItemOrderByWithRelationInput =
        sort === 'date_asc' ? { takenAt: 'asc' } : { takenAt: 'desc' };

    const items = await prisma.mediaItem.findMany({
        where,
        orderBy: [orderBy, { createdAt: 'desc' }],
        take: limit + 1,
        ...applyCursor(cursor),
        select: MEDIA_ITEM_SUMMARY_SELECT,
    });

    return paginateResults(items, limit);
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

    const keysToDelete = [item.originalKey];
    if (item.thumbnailKey) {
        keysToDelete.push(item.thumbnailKey);
    }

    logger.info({ mediaId: id, s3Keys: keysToDelete.length }, 'media: deleting item and S3 objects');
    await Promise.all([
        s3Service.deleteObjects(keysToDelete),
        prisma.mediaItem.delete({ where: { id } }),
    ]);
    logger.info({ mediaId: id }, 'media: item deleted');

    if (personIds.length > 0) {
        const orphansDeleted = await personsService.deleteOrphanPersons(personIds);
        if (orphansDeleted > 0) {
            logger.info({ mediaId: id, orphansDeleted }, 'media: orphan persons cleaned up');
        }
    }
}

export async function batchDeleteMedia(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, originalKey: true, thumbnailKey: true },
    });

    const personIds = await personsService.getAffectedPersonIds(ids);

    const keysToDelete = items.flatMap((item) => {
        const keys = [item.originalKey];
        if (item.thumbnailKey) {
            keys.push(item.thumbnailKey);
        }
        return keys;
    });

    logger.info({ requested: ids.length, found: items.length, s3Keys: keysToDelete.length }, 'media: batch deleting');
    await Promise.all([
        s3Service.deleteObjects(keysToDelete),
        prisma.mediaItem.deleteMany({ where: { id: { in: ids } } }),
    ]);
    logger.info({ deleted: items.length }, 'media: batch delete completed');

    if (personIds.length > 0) {
        const orphansDeleted = await personsService.deleteOrphanPersons(personIds);
        if (orphansDeleted > 0) {
            logger.info({ orphansDeleted }, 'media: orphan persons cleaned up after batch delete');
        }
    }

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

    return s3Service.getPresignedDownloadUrl(item.thumbnailKey);
}

export async function getOriginalUrl(id: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id },
            select: { originalKey: true },
        }),
        'Media item'
    );
    return s3Service.getPresignedDownloadUrl(item.originalKey);
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
    const failedItems = await prisma.mediaItem.findMany({
        where: { processingStatus: 'FAILED' },
        select: { id: true, originalKey: true, mimeType: true, type: true },
    });

    for (const item of failedItems) {
        await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type);
    }

    logger.info({ count: failedItems.length }, 'media: retried all failed items');
    return failedItems.length;
}

export async function batchRetryMedia(ids: string[]) {
    const items = await prisma.mediaItem.findMany({
        where: { id: { in: ids }, processingStatus: { in: ['FAILED', 'PENDING'] } },
        select: { id: true, originalKey: true, mimeType: true, type: true },
    });

    for (const item of items) {
        await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type);
    }

    logger.info({ requested: ids.length, retried: items.length }, 'media: batch retry completed');
    return items.length;
}

export async function enqueueAllPending() {
    const pendingItems = await prisma.mediaItem.findMany({
        where: { processingStatus: 'PENDING' },
        select: { id: true, originalKey: true, mimeType: true, type: true },
    });

    for (const item of pendingItems) {
        await _createTaskAndEnqueue(item.id, item.originalKey, item.mimeType, item.type);
    }

    logger.info({ count: pendingItems.length }, 'media: enqueued all pending items');
    return pendingItems.length;
}
