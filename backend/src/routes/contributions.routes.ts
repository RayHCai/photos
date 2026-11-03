import { Router } from 'express';
import { z } from 'zod';
import * as contributionsController from '../controllers/contributions.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/**
 * The owner's decisions on guest uploads, made from an upload's entry in its
 * album's change log.
 */
const router = Router();

router.use(authMiddleware);

/** Capped because denial deletes every item and its objects in one request. */
const decision = validate({
    body: z.object({ ids: z.array(z.string()).min(1).max(500) }),
});
router.post('/approve', decision, contributionsController.approve);
router.post('/reject', decision, contributionsController.reject);

export default router;
