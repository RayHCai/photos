import { Router } from 'express';
import { z } from 'zod';
import * as shareController from '../controllers/share.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicShareRateLimiter } from '../middleware/rateLimiter.js';

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

// Public share routes (no auth, dedicated higher rate limit)
router.get('/public/s/:slug', publicShareRateLimiter, shareController.viewShared);

/**
 * Paginated items for a shared collection. Split out from the metadata response
 * above so a large public link no longer ships its whole album into the guest tab
 * at once — the client windows it exactly like the authenticated gallery.
 */
router.get(
    '/public/s/:slug/items',
    publicShareRateLimiter,
    validate({
        query: z.object({
            cursor: z.string().optional(),
            offset: z.coerce.number().int().min(0).optional(),
            limit: z.coerce.number().min(1).max(500).optional(),
        }),
    }),
    shareController.sharedItems
);

/** Month counts for the shared gallery's timeline scrollbar (hidden excluded). */
router.get('/public/s/:slug/timeline', publicShareRateLimiter, shareController.sharedTimeline);

router.get(
    '/public/s/:slug/media/:mediaId/thumbnail',
    publicShareRateLimiter,
    shareController.sharedThumbnail
);

/**
 * Fit-to-screen variant for the shared lightbox. Without this route the client
 * had to fall back to /original, so a guest downloaded full-resolution originals
 * (three at a time for prev/current/next) and HEIC/HEVC files did not decode at
 * all outside Safari.
 */
router.get(
    '/public/s/:slug/media/:mediaId/web',
    publicShareRateLimiter,
    shareController.sharedWeb
);

router.get(
    '/public/s/:slug/media/:mediaId/original',
    publicShareRateLimiter,
    validate({
        // download=1 asks S3 for an attachment disposition so the file saves
        // rather than opening in the browser.
        query: z.object({
            download: z.enum(['1']).optional(),
        }),
    }),
    shareController.sharedOriginal
);

export default router;
