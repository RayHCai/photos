import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redisConnection } from './config/redis.js';
import { scheduleRecurringJobs } from './services/queue.service.js';
import { logger } from './utils/logger.js';

async function main() {
    await prisma.$connect();
    logger.info('Connected to PostgreSQL');

    await redisConnection.ping();
    logger.info('Connected to Redis');

    await scheduleRecurringJobs();
    logger.info('Scheduled recurring jobs');

    const app = createApp();

    app.listen(env.PORT, () => {
        logger.info(`Server running on port ${env.PORT}`);
    });
}

main().catch((err) => {
    logger.fatal(err, 'Failed to start server');
    process.exit(1);
});

const shutdown = async () => {
    logger.info('Shutting down...');
    await prisma.$disconnect();
    await redisConnection.quit();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
