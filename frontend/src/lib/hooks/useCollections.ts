'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMutationWithInvalidation } from './useMutationWithInvalidation';
import * as collectionsApi from '../api/collections';
import { queryKeys } from '../queries/keys';
import type { CollectionWithItems } from '../types/collections';
import type { MediaShellItem } from '../types/media';

export function useCollections() {
    return useQuery({
        queryKey: ['collections'],
        queryFn: collectionsApi.listCollections,
    });
}

/**
 * A collection's items, paged as the gallery scrolls.
 *
 * `GET /collections/:id` and the system-collection endpoints have always been
 * cursor-paginated server-side (`COLLECTION_ITEMS_PAGE_SIZE`, 500), but they were
 * read through a plain `useQuery` that only ever requested the first page. Any
 * collection larger than that rendered its newest 500 items and offered no way to
 * reach the rest — the same truncation the main gallery had, minus the symptom
 * being obvious, because nothing told the user items were missing.
 */
function useCollectionPages(
    queryKey: readonly unknown[],
    fetchPage: (params: { cursor?: string }) => Promise<CollectionWithItems>,
    enabled = true,
) {
    const query = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => fetchPage(pageParam ? { cursor: pageParam } : {}),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        enabled,
    });

    // Metadata (name, share links, total count) is identical on every page.
    const collection = query.data?.pages[0];

    const items = useMemo<MediaShellItem[]>(
        () => query.data?.pages.flatMap((p) => p.items.map((i) => i.mediaItem)) ?? [],
        [query.data]
    );

    // See useShellData: without `cancelRefetch: false`, overlapping requests for
    // the next page abort each other and pagination never advances.
    const { fetchNextPage } = query;
    const loadMore = useCallback(() => {
        void fetchNextPage({ cancelRefetch: false });
    }, [fetchNextPage]);

    return {
        collection,
        items,
        isLoading: query.isLoading,
        fetchNextPage: loadMore,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
    };
}

export function useCollection(id: string | undefined) {
    return useCollectionPages(
        ['collections', id],
        (params) => collectionsApi.getCollection(id!, params),
        !!id
    );
}

export function useHiddenCollection() {
    return useCollectionPages(
        queryKeys.collections.hidden(),
        collectionsApi.getHiddenCollection
    );
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
