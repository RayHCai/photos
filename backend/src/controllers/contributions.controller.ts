import { Request, Response } from 'express';
import * as contributionsService from '../services/contributions.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const approve = asyncHandler(async (req: Request, res: Response) => {
    const ids = req.body.ids as string[];
    logger.info({ count: ids.length }, 'approving uploads');
    const result = await contributionsService.approveContributions(ids);
    res.json(result);
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
    const ids = req.body.ids as string[];
    logger.info({ count: ids.length }, 'rejecting uploads');
    const result = await contributionsService.rejectContributions(ids);
    res.json(result);
});
