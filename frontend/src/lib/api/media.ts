import { apiFetch, apiUrl, buildQueryString } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaItem, MediaListItem, MediaShellItem, MediaType, TimelineMonth } from '../types/media';

export function listMedia(params: {
    cursor?: string;
    limit?: number;
    type?: MediaType;
    sort?: 'date_asc' | 'date_desc';
}): Promise<CursorPaginatedResponse<MediaListItem>> {
    const qs = buildQueryString(params);
    return apiFetch(`/media?${qs}`);
}

export function getMediaById(id: string): Promise<MediaItem> {
    return apiFetch(`/media/${id}`);
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

export function getTimeline(): Promise<TimelineMonth[]> {
    return apiFetch('/media/timeline');
}

export function thumbnailUrl(id: string): string {
    return apiUrl(`/media/${id}/thumbnail`);
}

export function getBatchThumbnailUrls(ids: string[]): Promise<Record<string, string>> {
    return apiFetch('/media/thumbnail-urls', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    });
}

export function originalUrl(id: string): string {
    return apiUrl(`/media/${id}/original`);
}

export function downloadMediaFile(id: string, urlFn: (id: string) => string = originalUrl) {
    const a = document.createElement('a');
    a.href = urlFn(id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
