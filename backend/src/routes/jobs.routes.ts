import { Router, Request, Response, NextFunction } from 'express';
import * as jobsController from '../controllers/jobs.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { serviceAuthMiddleware } from '../middleware/serviceAuth.js';

/** Accept either user session auth or service secret. */
const eitherAuth = (req: Request, res: Response, next: NextFunction) => {
    // Try service secret first (no cookie needed)
    const hasServiceSecret = !!req.headers['x-service-secret'];
    if (hasServiceSecret) {
        return serviceAuthMiddleware(req, res, next);
    }
    return authMiddleware(req, res, next);
};

const router = Router();

router.post('/enqueue-pending', serviceAuthMiddleware, jobsController.enqueuePending);
router.post('/backfill-blurhash', serviceAuthMiddleware, jobsController.backfillBlurHashes);
router.post('/backfill-all-blurhash', serviceAuthMiddleware, jobsController.backfillAllMissingBlurHashes);
router.post('/fix-orphaned-processing', serviceAuthMiddleware, jobsController.fixOrphanedProcessing);
router.post('/backfill-transcode', eitherAuth, jobsController.backfillTranscoding);
router.post('/backfill-web', eitherAuth, jobsController.backfillWebOptimized);
router.post('/recluster', eitherAuth, jobsController.triggerRecluster);
router.post('/rerun-missing-faces', eitherAuth, jobsController.rerunMissingFaces);
router.post('/backfill-geocode', eitherAuth, jobsController.backfillGeocoding);
router.post('/backfill-metadata', eitherAuth, jobsController.backfillMetadata);

router.post('/retry-failed', eitherAuth, jobsController.retryFailed);
router.post('/retry', eitherAuth, jobsController.batchRetry);

router.use(authMiddleware);

router.get('/stats', jobsController.getStats);
router.get('/storage-stats', jobsController.getStorageStats);
router.get('/processing-stats', jobsController.getProcessingStats);

export default router;
