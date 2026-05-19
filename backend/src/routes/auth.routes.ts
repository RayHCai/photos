import { Router } from 'express';
import { z } from 'zod';
import * as authController from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.post(
    '/login',
    validate({
        body: z.object({
            password: z.string().min(1),
        }),
    }),
    authController.login
);

router.get('/status', authMiddleware, authController.status);

export default router;
