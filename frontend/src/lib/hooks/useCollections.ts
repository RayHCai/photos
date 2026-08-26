'use client';

import { useQuery } from '@tanstack/react-query';
import { useMutationWithInvalidation } from './useMutationWithInvalidation';
import { useWindowedMedia } from './useWindowedMedia';
import * as collectionsApi from '../api/collections';
import { queryKeys } from '../queries/keys';
import type { CollectionWithItems } from '../types/collections';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaShellItem } from '../types/media';

export function useCollections() {
    return useQuery({
        queryKey: ['collections'],
        queryFn: collectionsApi.listCollections,
    });
}

/** Map a collection page response down to the gallery-shell shape the window consumes. */
function toShellPage(res: CollectionWithItems): CursorPaginatedResponse<MediaShellItem> {
    return {
        items: res.items.map((i) => i.mediaItem),
        nextCursor: res.nextCursor,
        hasMore: res.hasMore,
    };
}

/**
 * A collection's items as a sliding window, at home-gallery parity.
 *
 * The collection endpoints have always been server-paginated, but they were read
 * through a plain `useInfiniteQuery` that only walked forward and retained every
 * page for the session — the same unbounded growth the home gallery was fixed for,
 * plus a timeline derived from the loaded items alone (so the scrollbar only
 * described the pages fetched so far). Now the endpoint is offset-addressable and
 * date-ordered, so this composes the shared window engine (bidirectional
 * pagination + timeline seek) with two side queries: the collection's metadata
 * (name, count, share links) and its server-computed month timeline.
 *
 * Metadata, items and timeline all live under `['collections', ...]`, so one
 * `collection-membership`/`collection-set` invalidation refreshes them together.
 */
function useCollectionGallery(opts: {
    metaKey: readonly unknown[];
    fetchMeta: () => Promise<CollectionWithItems>;
    itemsKey: readonly unknown[];
    fetchItemsPage: (params: { offset: number; limit: number }) => Promise<CursorPaginatedResponse<MediaShellItem>>;
    /** Known upfront for a collection by id; derived from metadata for system collections. */
    knownId?: string;
    enabled?: boolean;
}) {
    const { metaKey, fetchMeta, itemsKey, fetchItemsPage, knownId, enabled = true } = opts;

    const meta = useQuery({ queryKey: metaKey, queryFn: fetchMeta, enabled });
    const collectionId = knownId ?? meta.data?.id;

    const timeline = useQuery({
        queryKey: ['collections', collectionId ?? 'unknown', 'timeline'],
        queryFn: () => collectionsApi.getCollectionTimeline(collectionId!),
        enabled: enabled && !!collectionId,
        staleTime: 60_000,
    });

    const windowed = useWindowedMedia({ queryKey: itemsKey, fetchPage: fetchItemsPage, enabled });

    return {
        collection: meta.data,
        // Always an array (never undefined), so the scrollbar treats this as a
        // scoped source and never falls back to the authenticated global timeline
        // (which excludes hidden items and 401s for a guest).
        timeline: timeline.data ?? [],
        ...windowed,
        isLoading: meta.isLoading || windowed.isLoading,
    };
}

export function useCollection(id: string | undefined) {
    return useCollectionGallery({
        metaKey: ['collections', id, 'meta'],
        // limit=1: only the header (name, count, share links) is wanted here; the
        // items come from the window below.
        fetchMeta: () => collectionsApi.getCollection(id!, { limit: 1 }),
        itemsKey: ['collections', id, 'window'],
        fetchItemsPage: ({ offset, limit }) =>
            collectionsApi.getCollection(id!, { offset, limit }).then(toShellPage),
        knownId: id,
        enabled: !!id,
    });
}

export function useHiddenCollection() {
    return useCollectionGallery({
        metaKey: queryKeys.collections.hidden(),
        fetchMeta: () => collectionsApi.getHiddenCollection({ limit: 1 }),
        itemsKey: ['collections', 'hidden', 'window'],
        fetchItemsPage: ({ offset, limit }) =>
            collectionsApi.getHiddenCollection({ offset, limit }).then(toShellPage),
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
