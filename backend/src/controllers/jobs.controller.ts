import { Request, Response } from 'express';
import * as queueService from '../services/queue.service.js';
import * as mediaService from '../services/media.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
    const stats = await queueService.getQueueStats();
    logger.debug({ stats }, 'queue stats fetched');
    res.json(stats);
});

export const retryFailed = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('retry all failed media requested');
    const count = await mediaService.retryAllFailed();
    logger.info({ count }, 'retry all failed media enqueued');
    res.json({ count });
});

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

export const enqueuePending = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('enqueue all pending media requested');
    const count = await mediaService.enqueueAllPending();
    logger.info({ count }, 'enqueue all pending media completed');
    res.json({ count });
});

export const backfillBlurHashes = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('blurhash backfill requested');
    const count = await mediaService.backfillBlurHashes();
    logger.info({ count }, 'blurhash backfill enqueued');
    res.json({ count });
});

export const backfillAllMissingBlurHashes = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('backfill ALL missing blurhashes requested');
    const count = await mediaService.backfillAllMissingBlurHashes();
    logger.info({ count }, 'backfill ALL missing blurhashes enqueued');
    res.json({ count });
});

export const fixOrphanedProcessing = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('fix orphaned PROCESSING items requested');
    const count = await mediaService.fixOrphanedProcessing();
    logger.info({ count }, 'orphaned PROCESSING items fixed');
    res.json({ count });
});
