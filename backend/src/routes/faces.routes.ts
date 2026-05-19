import { Router } from 'express';
import { z } from 'zod';
import * as facesController from '../controllers/faces.controller.js';
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
        }),
    }),
    facesController.listUnassigned
);

router.patch(
    '/:id/assign',
    validate({
        body: z.object({
            personId: z.string().min(1),
        }),
    }),
    facesController.assign
);

router.patch('/:id/unassign', facesController.unassign);

router.get('/:id/crop', facesController.getCrop);

export default router;
