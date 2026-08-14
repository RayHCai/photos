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

export interface ThumbnailLadderAudit {
    /** Completed items that have a thumbnail at all. */
    total: number;
    complete: number;
    /** Some rungs present but not all. */
    missingSome: number;
    /** No rungs at all — every srcset candidate fails and the cell renders blank. */
    missingAll: number;
    incomplete: number;
}

export function auditThumbnailLadders(): Promise<ThumbnailLadderAudit> {
    return apiFetch('/jobs/thumbnail-ladder-audit');
}

function postJob<T = { count: number }>(path: string): () => Promise<T> {
    return () => apiFetch(`/jobs/${path}`, { method: 'POST' });
}

export const enqueuePending = postJob('enqueue-pending');
export const retryFailed = postJob('retry-failed');
export const backfillBlurHashes = postJob('backfill-blurhash');
export const backfillAllBlurHashes = postJob('backfill-all-blurhash');
export const fixOrphanedProcessing = postJob('fix-orphaned-processing');
export const triggerRecluster = postJob<{ status: string }>('recluster');
export const rerunMissingFaces = postJob('rerun-missing-faces');
export const backfillTranscoding = postJob('backfill-transcode');
export const backfillWebOptimized = postJob('backfill-web');
export const backfillThumbnailLadder = postJob('backfill-thumbnail-ladder');
export const backfillThumbnailLadderVideos = postJob('backfill-thumbnail-ladder-videos');
export const backfillMissingThumbnailLadders = postJob<
    ThumbnailLadderAudit & { status: string; enqueued: number }
>('backfill-missing-thumbnail-ladder');
export const backfillGeocoding = postJob<{ status: string }>('backfill-geocode');
export const backfillMetadata = postJob('backfill-metadata');
// Answers with a real count rather than 202: it is a direct UPDATE, not a job fan-out.
export const backfillTakenAt = postJob('backfill-taken-at');
