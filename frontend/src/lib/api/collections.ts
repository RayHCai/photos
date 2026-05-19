import { apiFetch } from './client';
import type { Collection, CollectionWithItems } from '../types/collections';

export function listCollections(): Promise<Collection[]> {
    return apiFetch('/collections');
}

export function getCollection(id: string): Promise<CollectionWithItems> {
    return apiFetch(`/collections/${id}`);
}

export function createCollection(data: {
    name: string;
    description?: string;
}): Promise<Collection> {
    return apiFetch('/collections', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export function updateCollection(
    id: string,
    data: { name?: string; description?: string; coverKey?: string }
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
): Promise<{ added: number }> {
    return apiFetch(`/collections/${collectionId}/items`, {
        method: 'POST',
        body: JSON.stringify({ mediaItemIds }),
    });
}

export function removeItems(
    collectionId: string,
    mediaItemIds: string[]
): Promise<void> {
    return apiFetch(`/collections/${collectionId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ mediaItemIds }),
    });
}
