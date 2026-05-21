import { apiFetch } from './client';

export function batchRetry(ids: string[]): Promise<{ count: number }> {
    return apiFetch('/jobs/retry', { method: 'POST', body: JSON.stringify({ ids }) });
}
