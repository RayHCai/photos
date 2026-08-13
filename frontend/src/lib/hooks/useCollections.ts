'use client';

import { useQuery } from '@tanstack/react-query';
import { useMutationWithInvalidation } from './useMutationWithInvalidation';
import * as collectionsApi from '../api/collections';
import { queryKeys } from '../queries/keys';

export function useCollections() {
    return useQuery({
        queryKey: ['collections'],
        queryFn: collectionsApi.listCollections,
    });
}

export function useCollection(id: string | undefined) {
    return useQuery({
        queryKey: ['collections', id],
        queryFn: () => collectionsApi.getCollection(id!),
        enabled: !!id,
    });
}

export function useCreateCollection() {
    return useMutationWithInvalidation(collectionsApi.createCollection, [['collections']]);
}

export function useUpdateCollection() {
    return useMutationWithInvalidation(
        ({ id, data }: { id: string; data: { name?: string } }) =>
            collectionsApi.updateCollection(id, data),
        (_data, vars) => [['collections'], ['collections', vars.id]]
    );
}

export function useDeleteCollection() {
    return useMutationWithInvalidation(collectionsApi.deleteCollection, [['collections']]);
}

export function useAddCollectionItems() {
    return useMutationWithInvalidation(
        ({ collectionId, mediaItemIds }: { collectionId: string; mediaItemIds: string[] }) =>
            collectionsApi.addItems(collectionId, mediaItemIds),
        (_data, vars) => [['collections'], ['collections', vars.collectionId], ['collection-membership']]
    );
}

export function useRemoveCollectionItems() {
    return useMutationWithInvalidation(
        ({ collectionId, mediaItemIds }: { collectionId: string; mediaItemIds: string[] }) =>
            collectionsApi.removeItems(collectionId, mediaItemIds),
        (_data, vars) => [['collections'], ['collections', vars.collectionId], ['collection-membership']]
    );
}

/**
 * Which collections contain *every* one of these items.
 *
 * `enabled` is now caller-controlled, and the key uses a sorted id list.
 *
 * Both matter. AddToCollectionModal called this above its own `if (!open) return null`
 * guard, and SelectionToolbar keeps that modal mounted for the entire duration of a
 * selection — so the query was live with the modal closed, and because the key was the
 * raw id spread, every distinct selection was a brand-new key with no cached data and
 * therefore an immediate POST. Dragging through 80 photos on a phone fired 80+
 * requests in about three seconds, each carrying up to 80 ids and running a groupBy,
 * and left that many dead cache entries behind. Set iteration order also differs by
 * drag direction, so the same logical selection hashed to several different keys.
 */
export function useCollectionMembership(mediaItemIds: string[], enabled = true) {
    return useQuery({
        queryKey: queryKeys.collections.membership(mediaItemIds),
        queryFn: () => collectionsApi.getCollectionMembership(mediaItemIds),
        enabled: enabled && mediaItemIds.length > 0,
        select: (data) => new Set(data.collectionIds),
    });
}
