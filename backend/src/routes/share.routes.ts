import { Router } from 'express';
import { z } from 'zod';
import * as shareController from '../controllers/share.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicShareRateLimiter, publicUploadRateLimiter } from '../middleware/rateLimiter.js';
import { ARCHIVE_TOKEN_PATTERN } from '../services/archiveProgress.service.js';

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
            label: z.string().max(80).optional(),
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

router.post(
    '/share/:linkId/purge',
    authMiddleware,
    validate({ body: z.object({ revoke: z.boolean() }) }),
    shareController.purgeLink
);

// Public share routes (no auth, dedicated higher rate limit)
router.get('/public/s/:slug', publicShareRateLimiter, shareController.viewShared);

/** The album's change log, as much of it as a guest may see. */
router.get(
    '/public/s/:slug/events',
    publicShareRateLimiter,
    validate({ query: z.object({ cursor: z.string().optional() }) }),
    shareController.sharedEvents
);

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

/**
 * Download the whole shared collection as one zip — a form POST navigation, like
 * the library's /media/archive. The progress and cancel routes mirror the
 * library's, scoped under the slug because a guest has no session to reach those.
 */
router.post(
    '/public/s/:slug/archive',
    publicShareRateLimiter,
    validate({
        body: z.object({
            progressToken: z.string().regex(ARCHIVE_TOKEN_PATTERN).optional(),
        }),
    }),
    shareController.sharedArchive
);

const sharedArchiveTokenParams = {
    params: z.object({ slug: z.string(), token: z.string().regex(ARCHIVE_TOKEN_PATTERN) }),
};
router.get(
    '/public/s/:slug/archive/:token/progress',
    publicShareRateLimiter,
    validate(sharedArchiveTokenParams),
    shareController.sharedArchiveProgress
);
router.post(
    '/public/s/:slug/archive/:token/cancel',
    publicShareRateLimiter,
    validate(sharedArchiveTokenParams),
    shareController.cancelSharedArchive
);

/**
 * Guest uploads into a link that allows them. The same shape as the library's
 * /media/upload routes, but every file lands in the album only, awaiting the
 * owner's review before it reaches the library, and counts against the link's
 * quota. A limiter of their own, tighter than the viewing one, since each of
 * these signs an S3 write.
 */
const guestFile = z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    fileSize: z.number().int().positive(),
    contributorName: z.string().max(200).optional(),
});
const guestToken = z.object({ uploadToken: z.string().min(1) });

router.post(
    '/public/s/:slug/uploads/presign',
    publicUploadRateLimiter,
    validate({ body: guestFile }),
    shareController.guestPresign
);
router.post(
    '/public/s/:slug/uploads/confirm',
    publicUploadRateLimiter,
    validate({ body: guestToken }),
    shareController.guestConfirm
);
router.post(
    '/public/s/:slug/uploads/multipart/init',
    publicUploadRateLimiter,
    validate({ body: guestFile }),
    shareController.guestMultipartInit
);
router.post(
    '/public/s/:slug/uploads/multipart/presign',
    publicUploadRateLimiter,
    validate({ body: guestToken.extend({ partNumber: z.number().int().min(1).max(10000) }) }),
    shareController.guestMultipartPresign
);
router.post(
    '/public/s/:slug/uploads/multipart/complete',
    publicUploadRateLimiter,
    validate({
        body: guestToken.extend({
            parts: z
                .array(z.object({ PartNumber: z.number().int().positive(), ETag: z.string().min(1) }))
                .min(1)
                .max(10000),
        }),
    }),
    shareController.guestMultipartComplete
);

export default router;
