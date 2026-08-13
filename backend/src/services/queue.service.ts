import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/async.js';
import type { PipelineStage } from '../constants/pipeline.js';

export interface ProcessMediaJobData {
    mediaItemId: string;
    taskId: string;
    originalKey: string;
    mimeType: string;
    type: 'PHOTO' | 'VIDEO';
    startStage?: PipelineStage;
    /** Propagated from the originating HTTP request so logs can be correlated. */
    requestId?: string;
}

interface ReclusterJobData {
    triggeredBy: 'schedule' | 'manual';
}

interface CleanupSessionsJobData {
    maxAge: number;
}

interface GeocodeBackfillJobData {
    triggeredBy: 'schedule' | 'manual';
}

type MaintenanceJobData = ReclusterJobData | CleanupSessionsJobData | GeocodeBackfillJobData;

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

export const maintenanceQueue = new Queue<MaintenanceJobData>('maintenance', {
    connection: redisConnection,
    defaultJobOptions: {
        // Previously unset, so a transient failure (e.g. the worker being
        // restarted mid-recluster) permanently lost the job with no retry.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
    },
});

/**
 * Surfaces terminal job failures.
 *
 * Nothing previously reconciled a job that died without the worker managing to
 * write FAILED over HTTP (OOM kill, SIGKILL, network partition) — the media row
 * stayed PROCESSING forever, which in turn kept every open tab on the 5-second
 * full-library poll. This logs at error level so the failure is at least visible
 * to an aggregator; mediaService.reapStalledProcessing() does the DB repair.
 */
let mediaQueueEvents: QueueEvents | undefined;

export function startQueueEventListeners() {
    mediaQueueEvents = new QueueEvents('process-media', { connection: redisConnection.duplicate() });

    mediaQueueEvents.on('failed', ({ jobId, failedReason }) => {
        logger.error({ jobId, failedReason }, 'queue: media job failed');
    });

    mediaQueueEvents.on('stalled', ({ jobId }) => {
        logger.error({ jobId }, 'queue: media job stalled');
    });

    return mediaQueueEvents;
}

export async function enqueueMediaProcessing(data: ProcessMediaJobData) {
    const job = await mediaQueue.add('process', data, {
        priority: data.type === 'PHOTO' ? 1 : 2,
    });
    logger.info(
        {
            jobId: job.id,
            mediaItemId: data.mediaItemId,
            type: data.type,
            startStage: data.startStage,
            requestId: data.requestId,
        },
        'queue: media processing job added'
    );
    return job;
}

/** Enqueue many items in one round trip instead of one `add` per item. */
export async function enqueueMediaProcessingBulk(items: ProcessMediaJobData[]) {
    if (items.length === 0) return 0;
    await mediaQueue.addBulk(
        items.map((data) => ({
            name: 'process' as const,
            data,
            opts: { priority: data.type === 'PHOTO' ? 1 : 2 },
        }))
    );
    logger.info({ count: items.length }, 'queue: media processing jobs added (bulk)');
    return items.length;
}

export async function enqueueMaintenance(
    name: 'recluster' | 'geocode-backfill' | 'cleanup-sessions',
    data: MaintenanceJobData
) {
    const job = await maintenanceQueue.add(name, data);
    logger.info({ jobId: job.id, name }, 'queue: maintenance job added');
    return job;
}

export async function scheduleRecurringJobs() {
    // Weekly face recluster (Sunday 3AM)
    await maintenanceQueue.add(
        'recluster',
        { triggeredBy: 'schedule' as const },
        { repeat: { pattern: '0 3 * * 0' }, jobId: 'repeat:recluster' }
    );

    // Daily session cleanup
    await maintenanceQueue.add(
        'cleanup-sessions',
        { maxAge: 30 * 24 * 60 * 60 * 1000 },
        { repeat: { pattern: '0 4 * * *' }, jobId: 'repeat:cleanup-sessions' }
    );
}

/**
 * Reconcile rows stuck in PROCESSING.
 *
 * Runs in-process on an interval rather than as a queue job, because the whole
 * point is to recover from the worker being unavailable — routing it through the
 * worker's own queue would make it fail in exactly the situation it exists for.
 */
export function startStalledProcessingReaper(
    reap: () => Promise<number>,
    intervalMs = 10 * 60 * 1000
) {
    const timer = setInterval(() => {
        fireAndForget(reap, (err) => logger.error({ err }, 'reaper: failed'));
    }, intervalMs);
    timer.unref();
    return timer;
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

export async function closeQueues() {
    await Promise.allSettled([
        mediaQueue.close(),
        maintenanceQueue.close(),
        mediaQueueEvents?.close(),
    ]);
    logger.info('queues closed');
}
