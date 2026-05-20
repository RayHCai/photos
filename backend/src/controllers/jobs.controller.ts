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

export const enqueuePending = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('enqueue all pending media requested');
    const count = await mediaService.enqueueAllPending();
    logger.info({ count }, 'enqueue all pending media completed');
    res.json({ count });
});
