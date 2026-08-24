'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getProcessingUpdates, getShellData } from '../api/media';
import { queryKeys } from '../queries/keys';
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

type ShellPages = {
    pages: Array<CursorPaginatedResponse<MediaShellItem>>;
    // Each page's param is its offset (the global index of its first item), which
    // is what makes the loaded set a window that can start anywhere rather than a
    // prefix from index 0.
    pageParams: number[];
};

/**
 * The gallery's item list, as a *sliding window* over the library.
 *
 * Three architectural fixes here.
 *
 * 1. Windowed. `/media/shell` used to return the entire library in one response;
 *    then it was paginated but every page was retained for the session, so memory
 *    and per-append layout cost grew without bound until the tab crashed. React
 *    Query's `maxPages` now caps retention at `WINDOW_PAGES` and drops the far page
 *    as the user scrolls, so the held item count is bounded no matter how far the
 *    library is scrolled. Pages are addressed by *offset* so the window can be
 *    rebuilt anywhere for a timeline jump.
 *
 * 2. The processing poll is a *narrow* query. It used to re-fetch the entire shell
 *    payload every 5 seconds while any item was PENDING/PROCESSING. A small
 *    changed-ids feed now patches the cached pages in place.
 */
export function useShellData() {
    const queryClient = useQueryClient();

    const query = useInfiniteQuery({
        queryKey: queryKeys.media.shell(),
        // Offset addressing (not cursor): a window can start at any page, and
        // `getPreviousPageParam` needs to walk backwards, which a forward-only
        // cursor cannot. Offsets are exact against an unchanged table; an upload
        // mid-session shifts them by one at a window edge, which the `['media']`
        // invalidation on mutation resets.
        queryFn: ({ pageParam }) =>
            getShellData({ offset: pageParam, limit: SHELL_PAGE_SIZE }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _all, lastParam) =>
            lastPage.nextCursor ? lastParam + SHELL_PAGE_SIZE : undefined,
        getPreviousPageParam: (_firstPage, _all, firstParam) =>
            firstParam > 0 ? Math.max(0, firstParam - SHELL_PAGE_SIZE) : undefined,
        // The window. `maxPages` requires both param getters above to be defined so
        // it can drop from either end.
        maxPages: WINDOW_PAGES,
        staleTime: 60_000,
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

    const seekToIndex = useCallback(
        async (targetIndex: number) => {
            if (seekInFlightRef.current) return;

            const key = queryKeys.media.shell();
            const cached = queryClient.getQueryData<ShellPages>(key);
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
                await queryClient.cancelQueries({ queryKey: key });

                const fetched = await mapWithConcurrency(offsets, SEEK_CONCURRENCY, (offset) =>
                    getShellData({ offset, limit: SHELL_PAGE_SIZE }).then((page) => ({ offset, page }))
                );

                // Keep the leading contiguous, non-empty pages. An offset past the
                // end of the library returns an empty page and ends the window.
                const pages: ShellPages['pages'] = [];
                const pageParams: number[] = [];
                for (const { offset, page } of fetched) {
                    if (page.items.length === 0) break;
                    pages.push(page);
                    pageParams.push(offset);
                }
                if (pages.length === 0) return;

                queryClient.setQueryData<ShellPages>(key, { pages, pageParams });
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
