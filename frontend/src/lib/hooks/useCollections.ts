'use client';

import { useQuery } from '@tanstack/react-query';
import { useMutationWithInvalidation } from './useMutationWithInvalidation';
import * as collectionsApi from '../api/collections';

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

export function useCollectionMembership(mediaItemIds: string[]) {
    return useQuery({
        queryKey: ['collection-membership', ...mediaItemIds],
        queryFn: () => collectionsApi.getCollectionMembership(mediaItemIds),
        enabled: mediaItemIds.length > 0,
        select: (data) => new Set(data.collectionIds),
    });
}
