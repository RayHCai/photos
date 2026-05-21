import { Router } from 'express';
import * as jobsController from '../controllers/jobs.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { serviceAuthMiddleware } from '../middleware/serviceAuth.js';

const router = Router();

router.post('/enqueue-pending', serviceAuthMiddleware, jobsController.enqueuePending);
router.post('/backfill-blurhash', serviceAuthMiddleware, jobsController.backfillBlurHashes);
router.post('/backfill-all-blurhash', serviceAuthMiddleware, jobsController.backfillAllMissingBlurHashes);
router.post('/fix-orphaned-processing', serviceAuthMiddleware, jobsController.fixOrphanedProcessing);

router.use(authMiddleware);

router.get('/stats', jobsController.getStats);
router.post('/retry-failed', jobsController.retryFailed);
router.post('/retry', jobsController.batchRetry);

export default router;
