import { Router } from 'express';
import { z } from 'zod';
import * as mediaController from '../controllers/media.controller.js';
import { ARCHIVE_TOKEN_PATTERN } from '../services/archiveProgress.service.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authMiddleware);

router.get(
    '/',
    validate({
        query: z.object({
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(200).optional(),
            type: z.enum(['PHOTO', 'VIDEO']).optional(),
            sort: z.enum(['date_asc', 'date_desc']).optional(),
        }),
    }),
    mediaController.list
);

router.get(
    '/shell',
    validate({
        query: z.object({
            cursor: z.string().optional(),
            // Direct address for a timeline jump, so the client does not have to
            // walk every page between here and the month it wants.
            offset: z.coerce.number().int().min(0).optional(),
            limit: z.coerce.number().min(1).max(2000).optional(),
        }),
    }),
    mediaController.shell
);
router.get('/timeline', mediaController.timeline);
router.get(
    '/processing-updates',
    validate({ query: z.object({ since: z.string().datetime().optional() }) }),
    mediaController.processingUpdates
);

router.post(
    '/thumbnail-urls',
    validate({
        body: z.object({
            ids: z.array(z.string()).min(1).max(200),
        }),
    }),
    mediaController.batchThumbnails
);

/**
 * Reached by a form POST navigation from the client, so the ids arrive as one
 * comma-joined form field and the response is a zip stream rather than JSON.
 * Declared ahead of `/:id` for readability only — the methods differ, so there is
 * no route to shadow.
 */
router.post(
    '/archive',
    validate({
        body: z.object({
            ids: z.string().min(1),
            /**
             * Client-generated id the download is reported under. Optional: the
             * archive streams the same either way, and a client that does not
             * want a readout simply omits it. Constrained because it becomes part
             * of a Redis key.
             */
            progressToken: z.string().regex(ARCHIVE_TOKEN_PATTERN).optional(),
        }),
    }),
    mediaController.archive
);

/**
 * Progress for an archive in flight, and a way to stop it. Both are separate
 * requests because the download itself is a navigation whose response belongs to
 * the browser — nothing about it is observable from the page.
 *
 * Declared ahead of `/:id`, which would otherwise shadow nothing here (these have
 * three path segments) but reads better next to the endpoint they describe.
 */
const archiveTokenParams = { params: z.object({ token: z.string().regex(ARCHIVE_TOKEN_PATTERN) }) };
router.get(
    '/archive/:token/progress',
    validate(archiveTokenParams),
    mediaController.archiveProgressStatus
);
router.post(
    '/archive/:token/cancel',
    validate(archiveTokenParams),
    mediaController.cancelArchive
);

router.get('/:id', mediaController.getById);

router.post(
    '/upload/check-duplicates',
    validate({
        body: z.object({
            // Capped: this fans out one S3 HeadObject per name, so an uncapped
            // array let a single request issue thousands of concurrent S3 calls.
            fileNames: z.array(z.string().min(1)).min(1).max(500),
        }),
    }),
    mediaController.checkDuplicates
);

router.post(
    '/upload/presign',
    validate({
        body: z.object({
            fileName: z.string().min(1),
            mimeType: z.string().min(1),
            fileSize: z.number().positive(),
        }),
    }),
    mediaController.presign
);

router.post(
    '/upload/confirm',
    validate({
        body: z.object({
            id: z.string().min(1),
        }),
    }),
    mediaController.confirmUpload
);

router.post(
    '/upload/multipart/init',
    validate({
        body: z.object({
            fileName: z.string().min(1),
            mimeType: z.string().min(1),
            fileSize: z.number().positive(),
        }),
    }),
    mediaController.multipartInit
);

router.post(
    '/upload/multipart/presign',
    validate({
        body: z.object({
            s3Key: z.string().min(1),
            uploadId: z.string().min(1),
            partNumber: z.number().int().positive(),
        }),
    }),
    mediaController.multipartPresign
);

router.post(
    '/upload/multipart/complete',
    validate({
        body: z.object({
            mediaItemId: z.string().min(1),
            s3Key: z.string().min(1),
            uploadId: z.string().min(1),
            parts: z.array(
                z.object({
                    PartNumber: z.number().int().positive(),
                    ETag: z.string().min(1),
                })
            ).min(1),
        }),
    }),
    mediaController.multipartComplete
);

router.delete(
    '/',
    validate({
        body: z.object({
            ids: z.array(z.string()).min(1),
        }),
    }),
    mediaController.batchDelete
);

router.delete('/:id', mediaController.deleteOne);

router.get('/:id/thumbnail', mediaController.getThumbnail);
router.get('/:id/original', mediaController.getOriginal);
router.get('/:id/web', mediaController.getWeb);
router.get('/:id/download', mediaController.download);

export default router;
