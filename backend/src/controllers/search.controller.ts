import { Request, Response } from 'express';
import * as searchService from '../services/search.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const search = asyncHandler(async (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    logger.info({ q, page, limit }, 'search requested');

    const result = await searchService.search({ q, page, limit });

    logger.info(
        { q, searchType: result.searchType, resultCount: result.items.length, total: result.total },
        'search completed'
    );
    res.json(result);
});
