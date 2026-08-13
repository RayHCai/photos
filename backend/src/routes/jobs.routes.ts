import { Router } from 'express';
import { z } from 'zod';
import * as jobsController from '../controllers/jobs.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

/**
 * Every route here is operator-triggered maintenance, so all of them require a
 * user session.
 *
 * There used to be an `eitherAuth` helper that branched on the mere *presence*
 * of an `x-service-secret` header and, if present, delegated to
 * serviceAuthMiddleware. Combined with the old fail-open service auth, sending
 * `x-service-secret: anything` replaced session auth entirely on this router.
 * The worker never calls these routes (it uses /internal), so there is no reason
 * for a service-secret path here at all.
 */
router.use(authMiddleware);

router.post('/enqueue-pending', jobsController.enqueuePending);
router.post('/backfill-blurhash', jobsController.backfillBlurHashes);
router.post('/backfill-all-blurhash', jobsController.backfillAllMissingBlurHashes);
router.post('/fix-orphaned-processing', jobsController.fixOrphanedProcessing);
router.post('/backfill-transcode', jobsController.backfillTranscoding);
router.post('/backfill-web', jobsController.backfillWebOptimized);
router.post('/recluster', jobsController.triggerRecluster);
router.post('/rerun-missing-faces', jobsController.rerunMissingFaces);
router.post('/backfill-geocode', jobsController.backfillGeocoding);
router.post('/backfill-metadata', jobsController.backfillMetadata);
router.post('/retry-failed', jobsController.retryFailed);

router.post(
    '/retry',
    validate({
        body: z.object({
            ids: z.array(z.string().min(1)).min(1).max(1000),
        }),
    }),
    jobsController.batchRetry
);

router.get('/stats', jobsController.getStats);
router.get('/storage-stats', jobsController.getStorageStats);
router.get('/processing-stats', jobsController.getProcessingStats);

export default router;
