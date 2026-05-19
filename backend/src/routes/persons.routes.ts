import { Router } from 'express';
import { z } from 'zod';
import * as personsController from '../controllers/persons.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authMiddleware);

router.get('/', personsController.list);

router.get(
    '/:id',
    validate({
        query: z.object({
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(200).optional(),
        }),
    }),
    personsController.getById
);

router.patch(
    '/:id',
    validate({
        body: z.object({
            name: z.string().min(1).max(255),
        }),
    }),
    personsController.rename
);

router.post(
    '/merge',
    validate({
        body: z.object({
            targetId: z.string().min(1),
            sourceId: z.string().min(1),
        }),
    }),
    personsController.merge
);

router.delete('/:id', personsController.deleteOne);

router.get('/:id/avatar', personsController.getAvatar);

router.get(
    '/:id/media',
    validate({
        query: z.object({
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(200).optional(),
        }),
    }),
    personsController.getMedia
);

export default router;
