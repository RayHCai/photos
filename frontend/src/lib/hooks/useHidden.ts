'use client';

import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as collectionsApi from '../api/collections';

export function useHidden() {
    const queryClient = useQueryClient();

    const { data: hiddenCollection } = useQuery({
        queryKey: ['collections', 'hidden'],
        queryFn: collectionsApi.getHiddenCollection,
    });

    const hiddenIds = useMemo(() => {
        if (!hiddenCollection?.items) return new Set<string>();
        return new Set(hiddenCollection.items.map((item) => item.mediaItem.id));
    }, [hiddenCollection]);

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['collections', 'hidden'] });
        queryClient.invalidateQueries({ queryKey: ['media'] });
    }, [queryClient]);

    const hideItems = useCallback(async (mediaItemIds: string[]) => {
        if (!hiddenCollection) return;
        await collectionsApi.addItems(hiddenCollection.id, mediaItemIds);
        invalidate();
    }, [hiddenCollection, invalidate]);

    const unhideItems = useCallback(async (mediaItemIds: string[]) => {
        if (!hiddenCollection) return;
        await collectionsApi.removeItems(hiddenCollection.id, mediaItemIds);
        invalidate();
    }, [hiddenCollection, invalidate]);

    return { hiddenIds, hideItems, unhideItems, collectionId: hiddenCollection?.id };
}
