import { apiFetch, apiUrl, buildQueryString, LONG_TIMEOUT_MS } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaShellItem, TimelineMonth } from '../types/media';
import type { ShareLink, ShareLinkBase, SharedCollection } from '../types/share';
import type { PublicCollectionEvent, PurgeLinkResult } from '../types/contributions';

export function createShareLink(
    collectionId: string,
    data: { slug?: string; expiresAt?: string; label?: string }
): Promise<ShareLinkBase> {
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

/**
 * Remove everything that came through a link: uploads still waiting are denied
 * and approved ones are deleted from the library.
 */
export function purgeShareLink(linkId: string, revoke: boolean): Promise<PurgeLinkResult> {
    return apiFetch(`/share/${linkId}/purge`, {
        method: 'POST',
        body: JSON.stringify({ revoke }),
        timeoutMs: LONG_TIMEOUT_MS,
    });
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

/** The album's change log, as much of it as a guest may see. */
export function getSharedEvents(
    slug: string,
    params: { cursor?: string } = {}
): Promise<CursorPaginatedResponse<PublicCollectionEvent>> {
    const qs = buildQueryString(params);
    return apiFetch(`/public/s/${slug}/events${qs ? `?${qs}` : ''}`);
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

/** Endpoint that streams a zip of everything a guest can see in the share. */
export function sharedArchiveUrl(slug: string): string {
    return apiUrl(`/public/s/${slug}/archive`);
}

/** Where a shared archive's progress and cancel routes live; a guest has no session for the library's. */
export function sharedArchiveProgressBase(slug: string): string {
    return `/public/s/${slug}/archive`;
}
