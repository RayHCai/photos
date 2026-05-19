import { apiFetch, apiUrl } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaItem, MediaListItem } from '../types/media';

export function listMedia(params: {
    cursor?: string;
    limit?: number;
    type?: 'PHOTO' | 'VIDEO';
    sort?: 'date_asc' | 'date_desc';
}): Promise<CursorPaginatedResponse<MediaListItem>> {
    const sp = new URLSearchParams();
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.type) sp.set('type', params.type);
    if (params.sort) sp.set('sort', params.sort);
    return apiFetch(`/media?${sp}`);
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

export function thumbnailUrl(id: string): string {
    return apiUrl(`/media/${id}/thumbnail`);
}

export function originalUrl(id: string): string {
    return apiUrl(`/media/${id}/original`);
}
