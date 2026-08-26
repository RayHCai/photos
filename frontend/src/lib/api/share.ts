import { apiFetch, apiUrl, buildQueryString } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaShellItem, TimelineMonth } from '../types/media';
import type { ShareLink, SharedCollection } from '../types/share';

export function createShareLink(
    collectionId: string,
    data: { slug?: string; expiresAt?: string }
): Promise<ShareLink> {
    return apiFetch(`/collections/${collectionId}/share`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export function listShareLinks(collectionId: string): Promise<ShareLink[]> {
    return apiFetch(`/collections/${collectionId}/share`);
}

export function revokeShareLink(linkId: string): Promise<void> {
    return apiFetch(`/share/${linkId}`, { method: 'DELETE' });
}

export function getSharedCollection(slug: string): Promise<SharedCollection> {
    return apiFetch(`/public/s/${slug}`);
}

/** One offset-addressed page of a shared collection's items (windowed like the shell). */
export function getSharedItems(
    slug: string,
    params: { cursor?: string; offset?: number; limit?: number } = {}
): Promise<CursorPaginatedResponse<MediaShellItem>> {
    const qs = buildQueryString(params);
    return apiFetch(`/public/s/${slug}/items${qs ? `?${qs}` : ''}`);
}

/** Month counts for the shared gallery's timeline scrollbar (hidden excluded, no auth). */
export function getSharedTimeline(slug: string): Promise<TimelineMonth[]> {
    return apiFetch(`/public/s/${slug}/timeline`);
}

export function sharedThumbnailUrl(slug: string, mediaId: string): string {
    return apiUrl(`/public/s/${slug}/media/${mediaId}/thumbnail`);
}

export function sharedOriginalUrl(slug: string, mediaId: string): string {
    return apiUrl(`/public/s/${slug}/media/${mediaId}/original`);
}

/**
 * Same bytes as {@link sharedOriginalUrl}, but served with an attachment
 * disposition so the browser saves the file instead of rendering it.
 */
export function sharedDownloadUrl(slug: string, mediaId: string): string {
    return apiUrl(`/public/s/${slug}/media/${mediaId}/original?download=1`);
}
