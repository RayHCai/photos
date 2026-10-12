import { prisma } from '../config/prisma.js';

/**
 * The worker beats every WORKER_HEARTBEAT_INTERVAL_MS; it counts as offline
 * after three missed beats. Keep the interval in sync with the worker's
 * heartbeat_interval_seconds setting.
 */
export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
const OFFLINE_AFTER_MS = WORKER_HEARTBEAT_INTERVAL_MS * 3;

export async function recordHeartbeat(workerId: string, startedAt: Date): Promise<void> {
    // Timestamped with the API's clock, not the worker's, so the read-side
    // comparison is never skewed by drift between the two hosts.
    const now = new Date();
    await prisma.workerHeartbeat.upsert({
        where: { workerId },
        create: { workerId, startedAt, lastHeartbeatAt: now },
        update: { startedAt, lastHeartbeatAt: now },
    });
}

export async function getWorkerStatus(): Promise<{ online: boolean; lastHeartbeatAt: string | null }> {
    const latest = await prisma.workerHeartbeat.findFirst({
        orderBy: { lastHeartbeatAt: 'desc' },
        select: { lastHeartbeatAt: true },
    });
    if (!latest) return { online: false, lastHeartbeatAt: null };

    return {
        online: Date.now() - latest.lastHeartbeatAt.getTime() < OFFLINE_AFTER_MS,
        lastHeartbeatAt: latest.lastHeartbeatAt.toISOString(),
    };
}
