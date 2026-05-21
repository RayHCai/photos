import { Router } from 'express';
import { z } from 'zod';
import * as mediaController from '../controllers/media.controller.js';
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

router.get('/shell', mediaController.shell);
router.get('/timeline', mediaController.timeline);

router.get('/:id', mediaController.getById);

router.post(
    '/upload/check-duplicates',
    validate({
        body: z.object({
            fileNames: z.array(z.string().min(1)).min(1),
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

export default router;
