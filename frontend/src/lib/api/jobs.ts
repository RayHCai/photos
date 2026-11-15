import { apiFetch } from './client';

export function batchRetry(ids: string[]): Promise<{ count: number }> {
    return apiFetch('/jobs/retry', { method: 'POST', body: JSON.stringify({ ids }) });
}

export function getStorageStats(): Promise<{ totalBytes: string; totalItems: number }> {
    return apiFetch('/jobs/storage-stats');
}

export function getProcessingStats(): Promise<{ pending: number; processing: number; failed: number }> {
    return apiFetch('/jobs/processing-stats');
}

function postJob<T = { count: number }>(path: string): () => Promise<T> {
    return () => apiFetch(`/jobs/${path}`, { method: 'POST' });
}

export const enqueuePending = postJob('enqueue-pending');
export const retryFailed = postJob('retry-failed');
export const fixOrphanedProcessing = postJob('fix-orphaned-processing');
export const triggerRecluster = postJob<{ status: string }>('recluster');
export const rerunMissingFaces = postJob('rerun-missing-faces');

export interface WorkerStatus {
    online: boolean;
    lastHeartbeatAt: string | null;
}

export function getWorkerStatus(): Promise<WorkerStatus> {
    return apiFetch('/jobs/worker-status');
}
