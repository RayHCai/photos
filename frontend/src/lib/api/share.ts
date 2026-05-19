import { apiFetch, apiUrl } from './client';
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

export function sharedThumbnailUrl(slug: string, mediaId: string): string {
    return apiUrl(`/public/s/${slug}/media/${mediaId}/thumbnail`);
}

export function sharedOriginalUrl(slug: string, mediaId: string): string {
    return apiUrl(`/public/s/${slug}/media/${mediaId}/original`);
}
