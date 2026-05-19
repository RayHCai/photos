import { Router } from 'express';
import { z } from 'zod';
import * as shareController from '../controllers/share.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Authenticated share management routes
router.post(
    '/collections/:id/share',
    authMiddleware,
    validate({
        body: z.object({
            slug: z
                .string()
                .min(3)
                .max(50)
                .regex(/^[a-zA-Z0-9_-]+$/, 'Slug must be alphanumeric with dashes/underscores')
                .optional(),
            expiresAt: z.string().datetime().optional(),
        }),
    }),
    shareController.createLink
);

router.get(
    '/collections/:id/share',
    authMiddleware,
    shareController.listLinks
);

router.delete(
    '/share/:linkId',
    authMiddleware,
    shareController.revokeLink
);

// Public share routes (no auth)
router.get('/public/s/:slug', shareController.viewShared);

router.get(
    '/public/s/:slug/media/:mediaId/thumbnail',
    shareController.sharedThumbnail
);

router.get(
    '/public/s/:slug/media/:mediaId/original',
    shareController.sharedOriginal
);

export default router;
