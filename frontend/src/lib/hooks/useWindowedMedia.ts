'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    countLoadedItems,
    mapWithConcurrency,
    seekWindowOffsets,
    SEEK_CONCURRENCY,
    SHELL_PAGE_SIZE,
    WINDOW_PAGES,
} from '../utils/shellPaging';
import type { MediaShellItem } from '../types/media';
import type { CursorPaginatedResponse } from '../types/api';

type WindowPages = {
    pages: Array<CursorPaginatedResponse<MediaShellItem>>;
    // Each page's param is its offset (the global index of its first item), which
    // is what makes the loaded set a window that can start anywhere rather than a
    // prefix from index 0.
    pageParams: number[];
};

export interface WindowedMediaOptions {
    /** Cache key for this window. All three surfaces (shell, collection, share) use a distinct one. */
    queryKey: readonly unknown[];
    /**
     * Fetch one offset-addressed page. The window and every seek call this; it must
     * return the gallery-shell shape regardless of the underlying endpoint (a
     * collection maps its `{ mediaItem }` rows down to bare items).
     */
    fetchPage: (params: { offset: number; limit: number }) => Promise<CursorPaginatedResponse<MediaShellItem>>;
    enabled?: boolean;
    staleTime?: number;
}

export interface WindowedMediaResult {
    items: MediaShellItem[];
    windowStart: number;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchPreviousPage: () => void;
    hasPreviousPage: boolean;
    isFetchingPreviousPage: boolean;
    seekToIndex: (targetIndex: number) => Promise<void>;
    isSeeking: boolean;
}

/**
 * A gallery's item list, as a *sliding window* over an ordered media source.
 *
 * This is the shared engine behind the home gallery, collection detail and public
 * share views. Each supplies its own `queryKey` and `fetchPage`; everything about
 * the window is identical, which is the point — the three surfaces used to diverge
 * (the home gallery was windowed while collections retained every scrolled page and
 * a share held its whole album in memory).
 *
 * Windowed. React Query's `maxPages` caps retention at `WINDOW_PAGES` and drops the
 * far page as the user scrolls, so the held item count is bounded no matter how far
 * the source is scrolled. Pages are addressed by *offset* so the window can be
 * rebuilt anywhere for a timeline jump, and so `getPreviousPageParam` can walk
 * backwards — a forward-only cursor cannot.
 */
export function useWindowedMedia({
    queryKey,
    fetchPage,
    enabled = true,
    staleTime = 60_000,
}: WindowedMediaOptions): WindowedMediaResult {
    const queryClient = useQueryClient();

    const query = useInfiniteQuery({
        queryKey,
        queryFn: ({ pageParam }) => fetchPage({ offset: pageParam, limit: SHELL_PAGE_SIZE }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _all, lastParam) =>
            lastPage.nextCursor ? lastParam + SHELL_PAGE_SIZE : undefined,
        getPreviousPageParam: (_firstPage, _all, firstParam) =>
            firstParam > 0 ? Math.max(0, firstParam - SHELL_PAGE_SIZE) : undefined,
        // The window. `maxPages` requires both param getters above to be defined so
        // it can drop from either end.
        maxPages: WINDOW_PAGES,
        staleTime,
        enabled,
    });

    const items = useMemo<MediaShellItem[]>(
        () => query.data?.pages.flatMap((p) => p.items) ?? [],
        [query.data]
    );

    /**
     * Absolute index of the first loaded item — the offset of the first retained
     * page. Zero on a fresh load and while the window sits at the top; grows as
     * front pages are evicted during downward scroll. The scrollbar maps a global
     * item index to a row by subtracting this.
     */
    const windowStart = (query.data?.pageParams[0] as number | undefined) ?? 0;

    /**
     * `cancelRefetch: false` is load-bearing.
     *
     * React Query defaults it to true, so a second fetch while one is in flight
     * aborts and restarts it. Both the grid's scroll lookahead (either edge) and
     * the timeline scrollbar ask for pages, and a jump asks on every drag frame —
     * with the default the two livelocked, re-requesting the same page forever.
     */
    const { fetchNextPage, fetchPreviousPage } = query;
    const loadMore = useCallback(() => {
        fetchNextPage({ cancelRefetch: false });
    }, [fetchNextPage]);
    const loadPrevious = useCallback(() => {
        fetchPreviousPage({ cancelRefetch: false });
    }, [fetchPreviousPage]);

    /**
     * Rebuild the window around a *global* item index for a timeline jump.
     *
     * This is what the scrollbar calls when the month a user picked is outside the
     * loaded window. Rather than walk pages to it (one round trip each, rendering
     * every page on the way), it fetches a fresh window of pages centred on the
     * target in parallel and replaces the cached pages wholesale. Subsequent
     * scroll-driven `fetchNextPage`/`fetchPreviousPage` continue from the new
     * window's edges.
     *
     * Rejects if the fetch fails, so the caller can release the jump it is holding.
     */
    const seekInFlightRef = useRef(false);
    const [isSeeking, setIsSeeking] = useState(false);

    // Read through refs so `seekToIndex` keeps a stable identity even when the
    // caller passes an inline `queryKey` array or `fetchPage` closure — otherwise
    // it would re-arm the scrollbar's jump effects on every render.
    const queryKeyRef = useRef(queryKey);
    queryKeyRef.current = queryKey;
    const fetchPageRef = useRef(fetchPage);
    fetchPageRef.current = fetchPage;

    const seekToIndex = useCallback(
        async (targetIndex: number) => {
            if (seekInFlightRef.current) return;

            const queryKey = queryKeyRef.current;
            const fetchPage = fetchPageRef.current;
            const cached = queryClient.getQueryData<WindowPages>(queryKey);
            if (!cached || cached.pages.length === 0) return;

            // Already inside the loaded window — nothing to fetch; the scrollbar
            // lands on it directly.
            const start = cached.pageParams[0] ?? 0;
            const loaded = countLoadedItems(cached.pages);
            if (targetIndex >= start && targetIndex < start + loaded) return;

            const offsets = seekWindowOffsets(targetIndex);
            if (offsets.length === 0) return;

            seekInFlightRef.current = true;
            setIsSeeking(true);
            try {
                // Any in-flight page fetch would append onto whatever this writes.
                await queryClient.cancelQueries({ queryKey });

                const fetched = await mapWithConcurrency(offsets, SEEK_CONCURRENCY, (offset) =>
                    fetchPage({ offset, limit: SHELL_PAGE_SIZE }).then((page) => ({ offset, page }))
                );

                // Keep the leading contiguous, non-empty pages. An offset past the
                // end of the source returns an empty page and ends the window.
                const pages: WindowPages['pages'] = [];
                const pageParams: number[] = [];
                for (const { offset, page } of fetched) {
                    if (page.items.length === 0) break;
                    pages.push(page);
                    pageParams.push(offset);
                }
                if (pages.length === 0) return;

                /**
                 * Cancel again immediately before writing (F3).
                 *
                 * A mutation that settles during the seek's network wait invalidates
                 * `['media']` (or `['collections']`), which refetches this query from
                 * its *pre-seek* page params — the top of the source. Left in flight,
                 * that refetch resolves after this write and yanks the viewport back to
                 * the top of a jump the user just made. Cancelling here aborts it; any
                 * refetch that starts *after* this write reads the seeked params and so
                 * stays put.
                 */
                await queryClient.cancelQueries({ queryKey });
                queryClient.setQueryData<WindowPages>(queryKey, { pages, pageParams });
            }
            catch (err) {
                toast.error('Could not jump to that date');
                throw err;
            }
            finally {
                seekInFlightRef.current = false;
                setIsSeeking(false);
            }
        },
        [queryClient]
    );

    return {
        items,
        windowStart,
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error,
        fetchNextPage: loadMore,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        fetchPreviousPage: loadPrevious,
        hasPreviousPage: query.hasPreviousPage,
        isFetchingPreviousPage: query.isFetchingPreviousPage,
        seekToIndex,
        isSeeking,
    };
}
