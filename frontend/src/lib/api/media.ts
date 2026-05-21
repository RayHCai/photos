import { apiFetch, apiUrl, buildQueryString } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaItem, MediaListItem, MediaShellItem } from '../types/media';

export function listMedia(params: {
    cursor?: string;
    limit?: number;
    type?: 'PHOTO' | 'VIDEO';
    sort?: 'date_asc' | 'date_desc';
}): Promise<CursorPaginatedResponse<MediaListItem>> {
    const qs = buildQueryString(params);
    return apiFetch(`/media?${qs}`);
}

export function getMediaById(id: string): Promise<MediaItem> {
    return apiFetch(`/media/${id}`);
}

export function deleteMedia(id: string): Promise<void> {
    return apiFetch(`/media/${id}`, { method: 'DELETE' });
}

export function batchDeleteMedia(ids: string[]): Promise<{ deleted: number }> {
    return apiFetch('/media', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
    });
}

export function getShellData(): Promise<MediaShellItem[]> {
    return apiFetch('/media/shell');
}

export interface TimelineMonth {
    month: string; // yyyy-MM
    count: number;
}

export function getTimeline(): Promise<TimelineMonth[]> {
    return apiFetch('/media/timeline');
}

export function thumbnailUrl(id: string): string {
    return apiUrl(`/media/${id}/thumbnail`);
}

export function originalUrl(id: string): string {
    return apiUrl(`/media/${id}/original`);
}
