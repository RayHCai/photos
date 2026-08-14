import { Request, Response } from 'express';
import * as queueService from '../services/queue.service.js';
import * as mediaService from '../services/media.service.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler, fireAndForget } from '../utils/async.js';
import { logger } from '../utils/logger.js';

/**
 * Bulk maintenance handler.
 *
 * These endpoints page over the whole library and enqueue a job per row. Awaiting
 * that inside the request meant the client and load balancer timed out long before
 * the loop finished (roughly a million sequential round trips at 500k items) while
 * the work kept running detached. They now return 202 immediately and report
 * progress through the existing /jobs/stats and /jobs/processing-stats endpoints.
 */
function bulkJobHandler(serviceFn: () => Promise<number>, label: string) {
    return asyncHandler(async (_req: Request, res: Response) => {
        logger.info(`${label} requested`);

        res.status(202).json({ status: 'accepted' });

        fireAndForget(
            async () => {
                const count = await serviceFn();
                logger.info({ count }, `${label} completed`);
            },
            (err) => logger.error({ err }, `${label} failed`)
        );
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
    // Shape is guaranteed by the route's zod schema.
    const ids = req.body.ids as string[];
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

export const backfillThumbnailLadder = bulkJobHandler(
    () => mediaService.backfillThumbnailLadder(),
    'thumbnail ladder backfill',
);

export const backfillThumbnailLadderVideos = bulkJobHandler(
    () => mediaService.backfillThumbnailLadderVideos(),
    'thumbnail ladder backfill (videos)',
);

export const backfillMetadata = bulkJobHandler(
    () => mediaService.backfillMetadata(),
    'metadata backfill',
);

/** Read-only: reports ladder coverage without enqueueing anything. */
export const auditThumbnailLadders = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('thumbnail ladder audit requested');
    const audit = await mediaService.auditThumbnailLadders();

    // incompleteIds is the actionable payload for the backfill, not something the
    // settings page renders — a library mid-repair could return thousands.
    const { incompleteIds, ...counts } = audit;
    res.json({ ...counts, incomplete: incompleteIds.length });
});

/**
 * Deliberately not a bulkJobHandler.
 *
 * The others have nothing to report at accept time, so they answer 202 and page
 * over the library detached. Here the audit *is* the answer — how many items are
 * actually broken — and reporting it is the whole reason to prefer this over the
 * unscoped backfill. So the listing is awaited (seconds: one round trip per
 * thousand objects) and only the enqueue runs detached.
 */
export const backfillMissingThumbnailLadders = asyncHandler(
    async (_req: Request, res: Response) => {
        logger.info('missing thumbnail ladder backfill requested');
        const audit = await mediaService.auditThumbnailLadders();

        res.status(202).json({
            status: 'accepted',
            total: audit.total,
            complete: audit.complete,
            missingSome: audit.missingSome,
            missingAll: audit.missingAll,
            enqueued: audit.incompleteIds.length,
        });

        fireAndForget(
            async () => {
                const count = await mediaService.enqueueThumbnailLadders(audit.incompleteIds);
                logger.info({ count }, 'missing thumbnail ladder backfill completed');
            },
            (err) => logger.error({ err }, 'missing thumbnail ladder backfill failed')
        );
    }
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
