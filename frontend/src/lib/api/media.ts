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

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE_URL;

/** True when a public CDN base is configured (build-time inlined). */
export const CDN_CONFIGURED = !!CDN_BASE;

export function thumbnailUrl(id: string): string {
    return apiUrl(`/media/${id}/thumbnail`);
}

/**
 * Direct CDN URL built from a stored key, or the redirect endpoint as a fallback
 * (presigned mode / missing key). Lets the browser skip the batch URL-resolution
 * round-trip and per-item 302 entirely when a CDN is configured.
 */
export function thumbnailUrlFromKey(thumbnailKey: string | null, id: string): string {
    if (CDN_BASE && thumbnailKey) return `${CDN_BASE}/${thumbnailKey}`;
    return apiUrl(`/media/${id}/thumbnail`);
}

/** Direct CDN URL from any stored key, or null when no CDN is configured. */
export function cdnUrlFromKey(key: string | null): string | null {
    return CDN_BASE && key ? `${CDN_BASE}/${key}` : null;
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

export function webUrl(id: string): string {
    return apiUrl(`/media/${id}/web`);
}

export function downloadUrl(id: string): string {
    return apiUrl(`/media/${id}/download`);
}
