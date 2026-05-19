import { apiFetch } from './client';

export function getQueueStats(): Promise<{
    media: { waiting: number; active: number; completed: number; failed: number };
    maintenance: { waiting: number; active: number; completed: number; failed: number };
}> {
    return apiFetch('/jobs/stats');
}

export function retryFailed(): Promise<{ count: number }> {
    return apiFetch('/jobs/retry-failed', { method: 'POST' });
}
