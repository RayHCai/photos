import { Router } from 'express';
import { z } from 'zod';
import * as internalController from '../controllers/internal.controller.js';
import { serviceAuthMiddleware } from '../middleware/serviceAuth.js';
import { validate } from '../middleware/validate.js';
import { PIPELINE_STAGES } from '../constants/pipeline.js';
import { WORKER_WRITABLE_PREFIXES } from '../constants/storage.js';

const router = Router();

router.use(serviceAuthMiddleware);

// ─── Geocoding ──────────────────────────────────────────────
// Must be before :id routes to avoid matching "needs-geocoding" as an id

router.get('/media/needs-geocoding', internalController.queryMediaForGeocoding);

router.put(
    '/media/:id/geocoding',
    validate({
        body: z.object({
            city: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
        }),
    }),
    internalController.persistGeocoding
);

// ─── Media Items ─────────────────────────────────────────────

router.get('/media/:id/file-name', internalController.getFileName);

router.post(
    '/media/:id/claim-task',
    validate({
        body: z.object({
            taskId: z.string().uuid(),
        }),
    }),
    internalController.claimTask,
);

router.post(
    '/media/:id/retry-task',
    validate({
        body: z.object({
            // Derived from the shared constant rather than re-listed by hand.
            // This copy used to omit 'metadata', so a retry for that stage was
            // rejected by zod and surfaced to the operator as an opaque 500.
            startStage: z.enum(PIPELINE_STAGES).default('full'),
        }),
    }),
    internalController.createRetryTask,
);

router.patch(
    '/media/:id/status',
    validate({
        body: z.object({
            status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
            error: z.string().nullable().optional(),
        }),
    }),
    internalController.setProcessingStatus
);

router.put(
    '/media/:id/content',
    validate({
        body: z.object({
            width: z.number().int().positive().nullable().optional(),
            height: z.number().int().positive().nullable().optional(),
            durationSeconds: z.number().nullable().optional(),
            takenAt: z.string().nullable().optional(),
            // Capture-local wall clock and its UTC offset. Day/month bucketing is
            // derived from the local value so a photo does not move between days
            // depending on the viewer's timezone.
            takenAtLocal: z.string().nullable().optional(),
            takenAtOffsetMin: z.number().int().min(-840).max(840).nullable().optional(),
            videoRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
                .nullable()
                .optional(),
            latitude: z.number().nullable().optional(),
            longitude: z.number().nullable().optional(),
            cameraMake: z.string().nullable().optional(),
            cameraModel: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
            ftsDocument: z.string(),
            thumbnailKey: z.string().nullable().optional(),
            clipEmbedding: z.array(z.number()).length(512).nullable().optional(),
            blurHash: z.string().nullable().optional(),
            webKey: z.string().nullable().optional(),
        }),
    }),
    internalController.persistContent
);

router.put(
    '/media/:id/blur-hash',
    validate({
        body: z.object({
            blurHash: z.string(),
        }),
    }),
    internalController.persistBlurHashOnly
);

router.put(
    '/media/:id/streaming-key',
    validate({
        body: z.object({
            streamingKey: z.string(),
        }),
    }),
    internalController.persistStreamingKey
);

router.put(
    '/media/:id/web-key',
    validate({
        body: z.object({
            webKey: z.string(),
        }),
    }),
    internalController.persistWebKey
);

router.get('/media/:id/thumbnail-key', internalController.getThumbnailKey);

router.put(
    '/media/:id/clip-embedding',
    validate({
        body: z.object({
            embedding: z.array(z.number()).length(512),
        }),
    }),
    internalController.persistClipOnly
);

// ─── Faces ───────────────────────────────────────────────────

router.delete('/media/:id/faces', internalController.clearFaces);

router.post(
    '/media/:id/faces/nearest',
    validate({
        body: z.object({
            embedding: z.array(z.number()).length(512),
            threshold: z.number().default(0.3),
        }),
    }),
    internalController.findNearestExisting
);

router.post(
    '/faces/nearest-person',
    validate({
        body: z.object({
            embedding: z.array(z.number()).length(512),
            threshold: z.number(),
        }),
    }),
    internalController.findNearestPerson
);

router.post(
    '/faces',
    validate({
        body: z.object({
            mediaItemId: z.string(),
            personId: z.string(),
            boxX: z.number(),
            boxY: z.number(),
            boxWidth: z.number(),
            boxHeight: z.number(),
            confidence: z.number(),
            cropKey: z.string().nullable().optional(),
            embedding: z.array(z.number()).length(512),
        }),
    }),
    internalController.insertFace
);

// Keyset-paginated: returning every 512-dim vector in one response exceeded
// V8's max string length past ~100k faces and took the process down.
router.get(
    '/faces/embeddings',
    validate({ query: z.object({ cursor: z.string().optional() }) }),
    internalController.getFaceEmbeddings
);

router.post('/media/:id/faces-scanned', internalController.markFacesScanned);

router.post(
    '/faces/batch-reassign',
    validate({
        body: z.object({
            assignments: z.array(z.object({
                faceId: z.string(),
                personId: z.string(),
            })).min(1).max(1000),
        }),
    }),
    internalController.batchReassignFaces
);

// ─── Persons ─────────────────────────────────────────────────

// Must precede any /persons/:id style route.
router.get('/persons/named', internalController.listNamedPersons);

router.post('/persons', internalController.createPerson);

router.post(
    '/persons/batch',
    validate({
        body: z.object({
            count: z.number().int().min(1).max(500),
        }),
    }),
    internalController.batchCreatePersons
);

// ─── Media Queries ───────────────────────────────────────────

router.get('/media/:id/info', internalController.getMediaItemInfo);

router.post(
    '/media/query-for-retry',
    validate({
        body: z.object({
            filter: z.enum(['all', 'failed', 'missing_clip', 'missing_faces', 'missing_blurhash']),
        }),
    }),
    internalController.queryMediaItemsForRetry
);

// ─── S3 Operations ───────────────────────────────────────────

router.get('/s3/download/:key(*)', internalController.getDownloadUrl);

router.post(
    '/s3/upload-url',
    validate({
        body: z.object({
            // 'originals' is deliberately excluded: only the user-facing presign
            // flow may write originals.
            prefix: z.enum(WORKER_WRITABLE_PREFIXES),
            contentType: z.string(),
        }),
    }),
    internalController.generateUploadUrl
);

// Presign an upload at a key derived from an existing managed key (the
// responsive thumbnail ladder). The key shape is validated server-side.
router.post(
    '/s3/upload-url-for-key',
    validate({
        body: z.object({
            key: z.string().min(1).max(300),
            contentType: z.string().min(1).max(100),
        }),
    }),
    internalController.presignUploadForKey
);

// ─── Cleanup ─────────────────────────────────────────────────

router.delete('/persons/orphans', internalController.deleteOrphanPersons);

// ─── Sessions ────────────────────────────────────────────────

router.delete('/sessions/expired', internalController.deleteExpiredSessions);

export default router;
