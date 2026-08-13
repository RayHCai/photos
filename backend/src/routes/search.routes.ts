import { Router } from 'express';
import { z } from 'zod';
import * as searchController from '../controllers/search.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authMiddleware);

router.get(
    '/',
    validate({
        query: z.object({
            q: z.string().optional(),
            page: z.coerce.number().min(1).optional(),
            limit: z.coerce.number().min(1).max(200).optional(),
            // The client already sent this and threaded it into its query key, but
            // it was absent here — and `validate` replaces req.query with the
            // parsed object, so zod stripped it silently and the filter never took
            // effect.
            type: z.enum(['PHOTO', 'VIDEO']).optional(),
        }),
    }),
    searchController.search
);

export default router;
