import { apiFetch, apiUrl, buildQueryString } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type {
    MediaItem,
    MediaListItem,
    MediaShellItem,
    MediaType,
    ProcessingUpdate,
    TimelineMonth,
} from '../types/media';

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

/** Paginated: the endpoint no longer returns the whole library in one response. */
export function getShellData(params: { cursor?: string; limit?: number } = {}): Promise<
    CursorPaginatedResponse<MediaShellItem>
> {
    const qs = buildQueryString(params);
    return apiFetch(`/media/shell${qs ? `?${qs}` : ''}`);
}

export function getTimeline(): Promise<TimelineMonth[]> {
    return apiFetch('/media/timeline');
}

/**
 * Narrow feed of items whose processing state changed.
 *
 * Replaces re-fetching the entire shell payload every 5 seconds while anything was
 * processing — which meant one stuck row made every open tab re-download and
 * re-lay-out the whole library indefinitely.
 */
export function getProcessingUpdates(since?: string): Promise<{
    items: ProcessingUpdate[];
    pendingCount: number;
    cursor: string | null;
}> {
    const qs = buildQueryString({ since });
    return apiFetch(`/media/processing-updates${qs ? `?${qs}` : ''}`);
}

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE_URL;

/** True when a public CDN base is configured (build-time inlined). */
export const CDN_CONFIGURED = !!CDN_BASE;

/**
 * Widths the worker emits for each thumbnail, smallest first.
 * Keep in sync with worker/src/worker/thumbnail.py THUMBNAIL_WIDTHS.
 */
export const THUMBNAIL_WIDTHS = [200, 400, 800] as const;

/**
 * The one place a thumbnail URL is constructed.
 *
 * There were five builders (`thumbnailUrl`, `thumbnailUrlFromKey`, `cdnUrlFromKey`,
 * the batch resolver, and the lightbox's own placeholder path) and they disagreed:
 * with a CDN configured the grid used a direct CDN URL while the lightbox's
 * "instant" placeholder used the API redirect, guaranteeing a cache miss and an
 * extra authenticated round trip for the one image that was supposed to appear
 * immediately.
 */
export function thumbnailUrlFromKey(thumbnailKey: string | null, id: string): string {
    if (CDN_BASE && thumbnailKey) return `${CDN_BASE}/${thumbnailKey}`;
    return apiUrl(`/media/${id}/thumbnail`);
}

/** Kept for callers that only hold an id (no key available). */
export function thumbnailUrl(id: string): string {
    return apiUrl(`/media/${id}/thumbnail`);
}

/**
 * `srcset` for a thumbnail key, so the browser picks a width appropriate to the
 * cell size and device pixel ratio.
 *
 * Only meaningful in CDN mode: the redirect endpoint resolves a single variant, so
 * there is nothing to choose between.
 */
export function thumbnailSrcSet(thumbnailKey: string | null): string | undefined {
    if (!CDN_BASE || !thumbnailKey) return undefined;

    // Keys are `thumbnails/YYYY/MM/<uuid>.webp`; variants sit alongside as
    // `<uuid>@200w.webp`. A key without the marker is a legacy single-width
    // thumbnail, so fall back to no srcset rather than emitting 404s.
    const dot = thumbnailKey.lastIndexOf('.');
    if (dot === -1) return undefined;
    const stem = thumbnailKey.slice(0, dot);
    const ext = thumbnailKey.slice(dot);

    return THUMBNAIL_WIDTHS.map((w) => `${CDN_BASE}/${stem}@${w}w${ext} ${w}w`).join(', ');
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
