'use client';

import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as collectionsApi from '../api/collections';

export function useFavorites() {
    const queryClient = useQueryClient();

    const { data: favoritesCollection } = useQuery({
        queryKey: ['collections', 'favorites'],
        queryFn: collectionsApi.getFavoritesCollection,
    });

    const favoriteIds = useMemo(() => {
        if (!favoritesCollection?.items) return new Set<string>();
        return new Set(favoritesCollection.items.map((item) => item.mediaItem.id));
    }, [favoritesCollection]);

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['collections', 'favorites'] });
        queryClient.invalidateQueries({ queryKey: ['collections'] });
    }, [queryClient]);

    const addToFavorites = useCallback(async (mediaItemIds: string[]) => {
        if (!favoritesCollection) return;
        await collectionsApi.addItems(favoritesCollection.id, mediaItemIds);
        invalidate();
    }, [favoritesCollection, invalidate]);

    const removeFromFavorites = useCallback(async (mediaItemIds: string[]) => {
        if (!favoritesCollection) return;
        await collectionsApi.removeItems(favoritesCollection.id, mediaItemIds);
        invalidate();
    }, [favoritesCollection, invalidate]);

    return { favoriteIds, addToFavorites, removeFromFavorites };
}
