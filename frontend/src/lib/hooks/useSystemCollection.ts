'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as collectionsApi from '../api/collections';
import { queryKeys } from '../queries/keys';
import { useAppMutation } from './useAppMutation';

export type SystemCollection = 'favorites' | 'hidden';

const config = {
    favorites: {
        idsKey: queryKeys.collections.favoriteIds(),
        fetchIds: collectionsApi.getFavoriteIds,
        addLabel: 'Added to Favorites',
        removeLabel: 'Removed from Favorites',
    },
    hidden: {
        idsKey: queryKeys.collections.hiddenIds(),
        fetchIds: collectionsApi.getHiddenIds,
        addLabel: 'Hidden',
        removeLabel: 'Unhidden',
    },
} as const;

/**
 * Membership of a system collection (Favorites or Hidden).
 *
 * Replaces useFavorites and useHidden, which were the same hook twice with
 * divergent behaviour: they invalidated *different* key sets for the same kind of
 * operation (so hiding refreshed the timeline but favouriting did not, and neither
 * refreshed persons or search), and both downloaded the entire collection —
 * complete media rows for every member — purely to derive a Set of ids.
 *
 * Now: a dedicated ids endpoint, one shared invalidation set, and optimistic
 * updates so the star or the hide lands immediately instead of after two or three
 * serial round trips.
 */
export function useSystemCollection(kind: SystemCollection) {
    const { idsKey, fetchIds, addLabel, removeLabel } = config[kind];
    const queryClient = useQueryClient();

    const { data: ids } = useQuery({
        queryKey: idsKey,
        queryFn: fetchIds,
        // Membership is small and changes often; keep it fresh but not chatty.
        staleTime: 30_000,
    });

    const idSet = useMemo(() => new Set(ids ?? []), [ids]);

    /** Patches the local id list so the UI reflects the change on the next frame. */
    const applyOptimistic = useCallback(
        (mediaItemIds: string[], present: boolean) => {
            queryClient.setQueryData<string[]>(idsKey, (previous) => {
                const next = new Set(previous ?? []);
                for (const id of mediaItemIds) {
                    if (present) next.add(id);
                    else next.delete(id);
                }
                return [...next];
            });
        },
        [queryClient, idsKey]
    );

    const addMutation = useAppMutation<void, string[], { previous?: string[] }>({
        mutationFn: async (mediaItemIds) => {
            const collection = await collectionsApi.getSystemCollectionRef(kind);
            await collectionsApi.addItems(collection.id, mediaItemIds);
        },
        effects: ['collection-membership'],
        successMessage: addLabel,
        onMutate: (mediaItemIds) => {
            const previous = queryClient.getQueryData<string[]>(idsKey);
            applyOptimistic(mediaItemIds, true);
            return { previous };
        },
        onError: (_err, _vars, context) => {
            // Roll back: without this a failed request left the UI claiming the
            // photo was favourited.
            if (context?.previous) queryClient.setQueryData(idsKey, context.previous);
        },
    });

    const removeMutation = useAppMutation<void, string[], { previous?: string[] }>({
        mutationFn: async (mediaItemIds) => {
            const collection = await collectionsApi.getSystemCollectionRef(kind);
            await collectionsApi.removeItems(collection.id, mediaItemIds);
        },
        effects: ['collection-membership'],
        successMessage: removeLabel,
        onMutate: (mediaItemIds) => {
            const previous = queryClient.getQueryData<string[]>(idsKey);
            applyOptimistic(mediaItemIds, false);
            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) queryClient.setQueryData(idsKey, context.previous);
        },
    });

    /**
     * Toggle a single item. Reads membership from the query cache rather than a
     * render closure, so a rapid double-tap cannot act on a stale value and race
     * add against add.
     */
    const toggle = useCallback(
        (mediaItemId: string) => {
            const current = new Set(queryClient.getQueryData<string[]>(idsKey) ?? []);
            if (current.has(mediaItemId)) removeMutation.mutate([mediaItemId]);
            else addMutation.mutate([mediaItemId]);
        },
        [queryClient, idsKey, addMutation, removeMutation]
    );

    return {
        ids: idSet,
        add: addMutation.mutate,
        remove: removeMutation.mutate,
        toggle,
        isPending: addMutation.isPending || removeMutation.isPending,
    };
}

export function useFavorites() {
    const { ids, add, remove, toggle, isPending } = useSystemCollection('favorites');
    return { favoriteIds: ids, addToFavorites: add, removeFromFavorites: remove, toggleFavorite: toggle, isPending };
}

export function useHidden() {
    const { ids, add, remove, toggle, isPending } = useSystemCollection('hidden');
    return { hiddenIds: ids, hideItems: add, unhideItems: remove, toggleHidden: toggle, isPending };
}
