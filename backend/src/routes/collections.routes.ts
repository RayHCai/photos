import { Router } from 'express';
import { z } from 'zod';
import * as collectionsController from '../controllers/collections.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authMiddleware);

router.get('/', collectionsController.list);

router.post(
    '/',
    validate({
        body: z.object({
            name: z.string().min(1).max(255),
            description: z.string().max(1000).optional(),
        }),
    }),
    collectionsController.create
);

router.get('/hidden', collectionsController.getHidden);
router.get('/favorites', collectionsController.getFavorites);

router.get('/:id', collectionsController.getById);

router.patch(
    '/:id',
    validate({
        body: z.object({
            name: z.string().min(1).max(255).optional(),
            description: z.string().max(1000).optional(),
            coverKey: z.string().optional(),
        }),
    }),
    collectionsController.update
);

router.delete('/:id', collectionsController.deleteOne);

router.post(
    '/:id/items',
    validate({
        body: z.object({
            mediaItemIds: z.array(z.string()).min(1),
        }),
    }),
    collectionsController.addItems
);

router.delete(
    '/:id/items',
    validate({
        body: z.object({
            mediaItemIds: z.array(z.string()).min(1),
        }),
    }),
    collectionsController.removeItems
);

export default router;
