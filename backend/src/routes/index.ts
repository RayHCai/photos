import { Router } from 'express';
import authRoutes from './auth.routes.js';
import mediaRoutes from './media.routes.js';
import collectionsRoutes from './collections.routes.js';
import facesRoutes from './faces.routes.js';
import personsRoutes from './persons.routes.js';
import searchRoutes from './search.routes.js';
import shareRoutes from './share.routes.js';
import jobsRoutes from './jobs.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/media', mediaRoutes);
router.use('/collections', collectionsRoutes);
router.use('/faces', facesRoutes);
router.use('/persons', personsRoutes);
router.use('/search', searchRoutes);
router.use('/', shareRoutes);
router.use('/jobs', jobsRoutes);

export default router;
