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

router.post('/retry-failed', eitherAuth, jobsController.retryFailed);
router.post('/retry', eitherAuth, jobsController.batchRetry);

router.use(authMiddleware);

router.get('/stats', jobsController.getStats);

export default router;
