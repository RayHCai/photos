import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redisConnection } from './config/redis.js';
import {
    scheduleRecurringJobs,
    closeQueues,
    startQueueEventListeners,
    startStalledProcessingReaper,
} from './services/queue.service.js';
import { reapStalledProcessing } from './services/media.service.js';
import { logger } from './utils/logger.js';
import { fireAndForget } from './utils/async.js';

let server: Server | undefined;
let shuttingDown = false;

/**
 * Drain in-flight work before exiting.
 *
 * The previous handler called prisma.$disconnect() then process.exit(0)
 * immediately, so in-flight requests were killed mid-response, the HTTP listener
 * was never closed, the BullMQ queues were never closed, and the disconnect raced
 * against active queries.
 */
async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Backstop so a wedged connection cannot hang the container forever.
    const forceExit = setTimeout(() => {
        logger.error('graceful shutdown timed out; forcing exit');
        process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
        if (server) {
            await new Promise<void>((resolve, reject) => {
                server!.close((err) => (err ? reject(err) : resolve()));
            });
            logger.info('HTTP server closed');
        }

        await closeQueues();
        await prisma.$disconnect();
        await redisConnection.quit();
        logger.info('shutdown complete');
        clearTimeout(forceExit);
        process.exit(0);
    }
    catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
    }
}

async function main() {
    await prisma.$connect();
    logger.info('Connected to PostgreSQL');

    await redisConnection.ping();
    logger.info('Connected to Redis');

    await scheduleRecurringJobs();
    logger.info('Scheduled recurring jobs');

    startQueueEventListeners();
    logger.info('Queue event listeners started');

    startStalledProcessingReaper(() => reapStalledProcessing());
    logger.info('Stalled-processing reaper started');

    const app = createApp();

    server = app.listen(env.PORT, () => {
        logger.info(`Server running on port ${env.PORT}`);
    });
}

const onSignal = (signal: string) => {
    fireAndForget(() => shutdown(signal), (err) => logger.error({ err }, 'shutdown failed'));
};

process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

// Without these an unhandled rejection or uncaught exception tears the process
// down with nothing logged, which is indistinguishable from an OOM kill.
process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    onSignal('unhandledRejection');
});

process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    onSignal('uncaughtException');
});

main().catch((err) => {
    logger.fatal(err, 'Failed to start server');
    process.exit(1);
});
