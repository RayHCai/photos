import { Request, Response } from 'express';
import * as queueService from '../services/queue.service.js';
import * as mediaService from '../services/media.service.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

function bulkJobHandler(serviceFn: () => Promise<number>, label: string) {
    return asyncHandler(async (_req: Request, res: Response) => {
        logger.info(`${label} requested`);
        const count = await serviceFn();
        logger.info({ count }, `${label} completed`);
        res.json({ count });
    });
}

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
    const stats = await queueService.getQueueStats();
    logger.debug({ stats }, 'queue stats fetched');
    res.json(stats);
});

export const retryFailed = bulkJobHandler(
    () => mediaService.retryAllFailed(),
    'retry all failed media',
);

export const batchRetry = asyncHandler(async (req: Request, res: Response) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids array is required' });
        return;
    }
    logger.info({ count: ids.length }, 'batch retry media requested');
    const count = await mediaService.batchRetryMedia(ids);
    logger.info({ count }, 'batch retry media enqueued');
    res.json({ count });
});

export const enqueuePending = bulkJobHandler(
    () => mediaService.enqueueAllPending(),
    'enqueue all pending media',
);

export const backfillBlurHashes = bulkJobHandler(
    () => mediaService.backfillBlurHashes(),
    'blurhash backfill',
);

export const backfillAllMissingBlurHashes = bulkJobHandler(
    () => mediaService.backfillAllMissingBlurHashes(),
    'backfill ALL missing blurhashes',
);

export const fixOrphanedProcessing = bulkJobHandler(
    () => mediaService.fixOrphanedProcessing(),
    'fix orphaned PROCESSING items',
);

export const triggerRecluster = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('manual recluster requested');
    await queueService.maintenanceQueue.add('recluster', { triggeredBy: 'manual' as const });
    logger.info('manual recluster job enqueued');
    res.json({ status: 'enqueued' });
});

export const rerunMissingFaces = bulkJobHandler(
    () => mediaService.rerunMissingFaces(),
    'rerun missing faces',
);

export const backfillTranscoding = bulkJobHandler(
    () => mediaService.backfillTranscoding(),
    'transcode backfill',
);

export const backfillWebOptimized = bulkJobHandler(
    () => mediaService.backfillWebOptimized(),
    'web-optimized backfill',
);

export const backfillMetadata = bulkJobHandler(
    () => mediaService.backfillMetadata(),
    'metadata backfill',
);

export const backfillGeocoding = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('geocode backfill requested');
    await queueService.maintenanceQueue.add('geocode-backfill', { triggeredBy: 'manual' as const });
    logger.info('geocode backfill job enqueued');
    res.json({ status: 'enqueued' });
});

export const getStorageStats = asyncHandler(async (_req: Request, res: Response) => {
    const result = await prisma.mediaItem.aggregate({
        _sum: { fileSize: true },
        _count: { id: true },
    });
    res.json({
        totalBytes: (result._sum.fileSize ?? BigInt(0)).toString(),
        totalItems: result._count.id,
    });
});

export const getProcessingStats = asyncHandler(async (_req: Request, res: Response) => {
    const counts = await prisma.mediaItem.groupBy({
        by: ['processingStatus'],
        where: { processingStatus: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
        _count: { id: true },
    });
    const find = (s: string) => counts.find(c => c.processingStatus === s)?._count.id ?? 0;
    res.json({ pending: find('PENDING'), processing: find('PROCESSING'), failed: find('FAILED') });
});
