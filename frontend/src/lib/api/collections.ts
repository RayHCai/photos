import { apiFetch, buildQueryString } from './client';
import type {
    Collection,
    CollectionSummary,
    CollectionWithItems,
    SystemCollectionRef,
} from '../types/collections';

interface PageParams {
    cursor?: string;
    limit?: number;
}

function withPage(path: string, params: PageParams): string {
    const qs = buildQueryString({ cursor: params.cursor, limit: params.limit });
    return qs ? `${path}?${qs}` : path;
}

export function getHiddenCollection(params: PageParams = {}): Promise<CollectionWithItems> {
    return apiFetch(withPage('/collections/hidden', params));
}

export function getFavoritesCollection(params: PageParams = {}): Promise<CollectionWithItems> {
    return apiFetch(withPage('/collections/favorites', params));
}

/**
 * Just the member ids of a system collection.
 *
 * The favourites/hidden hooks only ever needed a Set of ids, but fetched the full
 * item payload — complete media rows for every member — on every home-page mount
 * and on every ['collections'] invalidation.
 */
export async function getFavoriteIds(): Promise<string[]> {
    const { ids } = await apiFetch<{ ids: string[] }>('/collections/favorites/ids');
    return ids;
}

export async function getHiddenIds(): Promise<string[]> {
    const { ids } = await apiFetch<{ ids: string[] }>('/collections/hidden/ids');
    return ids;
}

/** Resolves a system collection's id without pulling its items. */
export async function getSystemCollectionRef(
    kind: 'favorites' | 'hidden'
): Promise<SystemCollectionRef> {
    // limit=1 because only the id is wanted; the endpoint creates the collection on
    // first access, so this must stay a real request rather than a cached guess.
    const collection = await apiFetch<CollectionWithItems>(
        withPage(`/collections/${kind}`, { limit: 1 })
    );
    return { id: collection.id, name: collection.name };
}

export function listCollections(): Promise<CollectionSummary[]> {
    return apiFetch('/collections');
}

export function getCollection(
    id: string,
    params: PageParams = {}
): Promise<CollectionWithItems> {
    return apiFetch(withPage(`/collections/${id}`, params));
}

export function createCollection(data: { name: string }): Promise<Collection> {
    return apiFetch('/collections', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export function updateCollection(
    id: string,
    data: { name?: string; coverKey?: string }
): Promise<Collection> {
    return apiFetch(`/collections/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export function deleteCollection(id: string): Promise<void> {
    return apiFetch(`/collections/${id}`, { method: 'DELETE' });
}

export function addItems(
    collectionId: string,
    mediaItemIds: string[]
): Promise<{ message: string }> {
    return apiFetch(`/collections/${collectionId}/items`, {
        method: 'POST',
        body: JSON.stringify({ mediaItemIds }),
    });
}

export function removeItems(collectionId: string, mediaItemIds: string[]): Promise<void> {
    return apiFetch(`/collections/${collectionId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ mediaItemIds }),
    });
}

export function getCollectionMembership(
    mediaItemIds: string[]
): Promise<{ collectionIds: string[] }> {
    return apiFetch('/collections/membership', {
        method: 'POST',
        body: JSON.stringify({ mediaItemIds }),
    });
}
