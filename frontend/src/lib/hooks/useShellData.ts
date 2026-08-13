'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProcessingUpdates, getShellData } from '../api/media';
import { queryKeys } from '../queries/keys';
import type { MediaShellItem } from '../types/media';

/**
 * The gallery's item list.
 *
 * Two architectural fixes here.
 *
 * 1. Paginated. `/media/shell` used to return the entire library in one response, so
 *    nothing painted until the whole thing had transferred, parsed, grouped and laid
 *    out, and the array was then retained for the session. Pages now arrive as the
 *    user scrolls, and the timeline-counts endpoint supplies total scroll height so
 *    the scrollbar is correct from the first frame.
 *
 * 2. The processing poll is a *narrow* query. It used to re-fetch the entire shell
 *    payload every 5 seconds while any item was PENDING/PROCESSING — so one row
 *    wedged in PROCESSING (which nothing could reconcile) made every open tab
 *    re-download and re-lay-out the whole library indefinitely. A small changed-ids
 *    feed now patches the cached pages in place.
 */
export function useShellData() {
    const queryClient = useQueryClient();

    const query = useInfiniteQuery({
        queryKey: queryKeys.media.shell(),
        queryFn: ({ pageParam }) =>
            getShellData(pageParam ? { cursor: pageParam } : {}),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 60_000,
    });

    const items = useMemo<MediaShellItem[]>(
        () => query.data?.pages.flatMap((p) => p.items) ?? [],
        [query.data]
    );

    const hasPending = useMemo(
        () =>
            items.some(
                (i) => i.processingStatus === 'PENDING' || i.processingStatus === 'PROCESSING'
            ),
        [items]
    );

    // Watermark so each poll only asks for what changed since the last one.
    const sinceRef = useRef<string | undefined>(undefined);

    const { data: updates } = useQuery({
        queryKey: queryKeys.media.processing(),
        queryFn: () => getProcessingUpdates(sinceRef.current),
        // Only while something is actually in flight; stops on its own once the
        // server reports nothing pending.
        refetchInterval: hasPending ? 5_000 : false,
        enabled: hasPending,
        staleTime: 0,
    });

    /**
     * Patch the cached pages in place rather than invalidating them, so a photo
     * finishing processing does not cost a full re-fetch and re-layout of the grid.
     */
    useEffect(() => {
        if (!updates || updates.items.length === 0) return;
        sinceRef.current = updates.cursor ?? sinceRef.current;

        const byId = new Map(updates.items.map((u) => [u.id, u]));

        queryClient.setQueryData<typeof query.data>(queryKeys.media.shell(), (previous) => {
            if (!previous) return previous;
            let changed = false;

            const pages = previous.pages.map((page) => {
                let pageChanged = false;
                const nextItems = page.items.map((item) => {
                    const update = byId.get(item.id);
                    if (!update) return item;
                    pageChanged = true;
                    return { ...item, ...update };
                });
                if (!pageChanged) return page;
                changed = true;
                return { ...page, items: nextItems };
            });

            return changed ? { ...previous, pages } : previous;
        });
        // query.data is read through setQueryData's updater rather than captured, so
        // it is deliberately not a dependency.
    }, [updates, queryClient]);

    /**
     * `cancelRefetch: false` is load-bearing.
     *
     * React Query defaults it to true, so a second `fetchNextPage()` while one is
     * in flight *aborts and restarts* it. Both the grid's scroll lookahead and the
     * timeline scrollbar's jump-chasing ask for pages, and a jump asks on every
     * drag frame — with the default the two livelocked, re-requesting the same
     * cursor indefinitely and never advancing past it.
     */
    const { fetchNextPage } = query;
    const loadMore = useCallback(() => {
        void fetchNextPage({ cancelRefetch: false });
    }, [fetchNextPage]);

    return {
        items,
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        fetchNextPage: loadMore,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
    };
}
