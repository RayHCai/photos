'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as collectionsApi from '../api/collections';

export function useCollections() {
    return useQuery({
        queryKey: ['collections'],
        queryFn: collectionsApi.listCollections,
    });
}

export function useCollection(id: string) {
    return useQuery({
        queryKey: ['collections', id],
        queryFn: () => collectionsApi.getCollection(id),
        enabled: !!id,
    });
}

export function useCreateCollection() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: collectionsApi.createCollection,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
        },
    });
}

export function useUpdateCollection() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string } }) =>
            collectionsApi.updateCollection(id, data),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            queryClient.invalidateQueries({ queryKey: ['collections', vars.id] });
        },
    });
}

export function useDeleteCollection() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: collectionsApi.deleteCollection,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
        },
    });
}

export function useAddCollectionItems() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ collectionId, mediaItemIds }: { collectionId: string; mediaItemIds: string[] }) =>
            collectionsApi.addItems(collectionId, mediaItemIds),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['collections', vars.collectionId] });
        },
    });
}

export function useRemoveCollectionItems() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ collectionId, mediaItemIds }: { collectionId: string; mediaItemIds: string[] }) =>
            collectionsApi.removeItems(collectionId, mediaItemIds),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['collections', vars.collectionId] });
        },
    });
}
