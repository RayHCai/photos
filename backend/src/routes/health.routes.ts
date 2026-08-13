import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Liveness: the process is up and the event loop is turning. Deliberately does
 * no I/O so a slow dependency cannot cause an orchestrator to kill a healthy
 * process.
 */
router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

/**
 * Readiness: this instance can actually serve traffic. Checked by the load
 * balancer and by docker/k8s before routing. Previously neither existed, so a
 * post-boot loss of Postgres or Redis was invisible — every request 500'd with
 * nothing to detect or restart it.
 */
router.get('/readyz', async (_req, res) => {
    const checks: Record<string, 'ok' | 'fail'> = {};

    const [dbResult, redisResult] = await Promise.allSettled([
        prisma.$queryRaw`SELECT 1`,
        redisConnection.ping(),
    ]);

    checks.database = dbResult.status === 'fulfilled' ? 'ok' : 'fail';
    checks.redis = redisResult.status === 'fulfilled' ? 'ok' : 'fail';

    const ready = Object.values(checks).every((v) => v === 'ok');

    if (!ready) {
        if (dbResult.status === 'rejected') {
            logger.error({ err: dbResult.reason }, 'readyz: database check failed');
        }
        if (redisResult.status === 'rejected') {
            logger.error({ err: redisResult.reason }, 'readyz: redis check failed');
        }
    }

    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

export default router;
