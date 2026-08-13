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

router.post(
    '/membership',
    validate({
        body: z.object({
            mediaItemIds: z.array(z.string()).min(1).max(1000),
        }),
    }),
    collectionsController.membership
);

const itemPagination = validate({
    query: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().min(1).max(500).optional(),
    }),
});

// Static segments must precede /:id or they are captured as an id.
router.get('/hidden/ids', collectionsController.getHiddenIds);
router.get('/favorites/ids', collectionsController.getFavoriteIds);
router.get('/hidden', itemPagination, collectionsController.getHidden);
router.get('/favorites', itemPagination, collectionsController.getFavorites);

router.get('/:id', itemPagination, collectionsController.getById);

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
