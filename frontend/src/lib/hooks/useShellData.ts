'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProcessingUpdates, getShellData } from '../api/media';
import { queryKeys } from '../queries/keys';
import { useWindowedMedia } from './useWindowedMedia';
import type { CursorPaginatedResponse } from '../types/api';
import type { MediaShellItem } from '../types/media';

type ShellPages = {
    pages: Array<CursorPaginatedResponse<MediaShellItem>>;
    pageParams: number[];
};

/**
 * The home gallery's item list.
 *
 * The window (offset pagination, `maxPages`, bidirectional lookahead, timeline
 * seek) is the shared {@link useWindowedMedia} engine; this hook adds the one thing
 * unique to the library shell: the processing poll.
 *
 * That poll is a *narrow* query. It used to re-fetch the entire shell payload every
 * 5 seconds while any item was PENDING/PROCESSING; a small changed-ids feed now
 * patches the cached pages in place, so a photo finishing processing does not cost
 * a full re-fetch and re-layout of the grid.
 */
export function useShellData() {
    const queryClient = useQueryClient();

    const windowed = useWindowedMedia({
        queryKey: queryKeys.media.shell(),
        // Offset addressing (not cursor): offsets are exact against an unchanged
        // table; an upload mid-session shifts them by one at a window edge, which
        // the `['media']` invalidation on mutation resets.
        fetchPage: ({ offset, limit }) => getShellData({ offset, limit }),
    });

    const { items } = windowed;

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

        queryClient.setQueryData<ShellPages>(queryKeys.media.shell(), (previous) => {
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
        // query data is read through setQueryData's updater rather than captured, so
        // it is deliberately not a dependency.
    }, [updates, queryClient]);

    return windowed;
}
