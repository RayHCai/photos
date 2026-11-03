import { apiFetch, LONG_TIMEOUT_MS } from './client';
import type { DecisionResult } from '../types/contributions';

/** Approve guest uploads into the library; they are already in their album. */
export function approveContributions(ids: string[]): Promise<DecisionResult> {
    return apiFetch('/contributions/approve', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    });
}

/** Deny guest uploads: they are deleted, from the album and from storage. */
export function rejectContributions(ids: string[]): Promise<{ rejected: number }> {
    return apiFetch('/contributions/reject', {
        method: 'POST',
        body: JSON.stringify({ ids }),
        timeoutMs: LONG_TIMEOUT_MS,
    });
}
