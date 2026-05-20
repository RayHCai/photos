import { Router } from 'express';
import * as jobsController from '../controllers/jobs.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { serviceAuthMiddleware } from '../middleware/serviceAuth.js';

const router = Router();

router.post('/enqueue-pending', serviceAuthMiddleware, jobsController.enqueuePending);

router.use(authMiddleware);

router.get('/stats', jobsController.getStats);
router.post('/retry-failed', jobsController.retryFailed);

export default router;
