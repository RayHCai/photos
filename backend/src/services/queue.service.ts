import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';

interface ProcessMediaJobData {
    mediaItemId: string;
    taskId: string;
    originalKey: string;
    mimeType: string;
    type: 'PHOTO' | 'VIDEO';
    startStage?: 'full' | 'clip' | 'faces' | 'blurhash' | 'transcode';
}

interface ReclusterJobData {
    triggeredBy: 'schedule' | 'manual';
}

interface CleanupSessionsJobData {
    maxAge: number;
}

export const mediaQueue = new Queue<ProcessMediaJobData>('process-media', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
    },
});

export const maintenanceQueue = new Queue<ReclusterJobData | CleanupSessionsJobData>(
    'maintenance',
    { connection: redisConnection }
);

export async function enqueueMediaProcessing(data: ProcessMediaJobData) {
    const job = await mediaQueue.add('process', data, {
        priority: data.type === 'PHOTO' ? 1 : 2,
    });
    logger.info({ jobId: job.id, mediaItemId: data.mediaItemId, type: data.type, startStage: data.startStage }, 'queue: media processing job added');
    return job;
}

export async function scheduleRecurringJobs() {
    // Weekly face recluster (Sunday 3AM)
    await maintenanceQueue.add(
        'recluster',
        { triggeredBy: 'schedule' as const },
        {
            repeat: { pattern: '0 3 * * 0' },
        }
    );

    // Daily session cleanup
    await maintenanceQueue.add(
        'cleanup-sessions',
        { maxAge: 30 * 24 * 60 * 60 * 1000 },
        {
            repeat: { pattern: '0 4 * * *' },
        }
    );
}

export async function getQueueStats() {
    const [mediaWaiting, mediaActive, mediaCompleted, mediaFailed] = await Promise.all([
        mediaQueue.getWaitingCount(),
        mediaQueue.getActiveCount(),
        mediaQueue.getCompletedCount(),
        mediaQueue.getFailedCount(),
    ]);

    return {
        media: {
            waiting: mediaWaiting,
            active: mediaActive,
            completed: mediaCompleted,
            failed: mediaFailed,
        },
    };
}
