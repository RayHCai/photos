'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBatchThumbnailUrls } from '../api/media';
import type { VirtualRow } from '@/components/gallery/GalleryGrid';
import type { Virtualizer } from '@tanstack/react-virtual';

/**
 * Defensive upper bound, mirroring blurhashCache. The window eviction below already
 * keeps this Map at O(viewport), so this only matters for an unusually tall viewport.
 */
const MAX_CACHE_ENTRIES = 3000;

/** Rows of lookahead on each side of the viewport that are prefetched and retained. */
const PREFETCH_MARGIN_ROWS = 20;

export function useThumbnailPrefetch(
    virtualRows: VirtualRow[],
    virtualizer: Virtualizer<HTMLDivElement, Element>,
    enabled: boolean = true
) {
    const cache = useRef(new Map<string, string>());
    const pending = useRef(new Set<string>());
    const [version, setVersion] = useState(0);

    const thumbnailSrcFn = useCallback(
        (id: string): string | undefined => cache.current.get(id),
        [version]
    );

    useEffect(() => {
        if (!enabled || virtualRows.length === 0) return;

        const range = virtualizer.range;
        if (!range) return;

        const timeoutId = setTimeout(() => {
            const startIdx = Math.max(0, range.startIndex - PREFETCH_MARGIN_ROWS);
            const endIdx = Math.min(virtualRows.length - 1, range.endIndex + PREFETCH_MARGIN_ROWS);

            // Ids inside the prefetch window (visible + margin), the visible-only
            // subset (which decides whether a resolution forces a re-render), and the
            // not-yet-known ids to fetch.
            const keep = new Set<string>();
            const visible = new Set<string>();
            const ids: string[] = [];
            for (let i = startIdx; i <= endIdx; i++) {
                const row = virtualRows[i];
                if (row.type !== 'gallery-row' || !row.rowData) continue;
                const onScreen = i >= range.startIndex && i <= range.endIndex;
                for (const item of row.rowData.row.items) {
                    keep.add(item.id);
                    if (onScreen) visible.add(item.id);
                    if (!cache.current.has(item.id) && !pending.current.has(item.id)) {
                        ids.push(item.id);
                    }
                }
            }

            /**
             * Evict everything outside the current window (F5 / P1).
             *
             * This Map is a *separate* cache from the React Query page window, and it
             * was insert-only — it grew by one entry per unique photo ever scrolled,
             * the primary contributor to the long-scroll crash in presigned mode.
             * Pruning to the window bounds it at O(viewport) no matter how far the
             * gallery is scrolled. Deleting during iteration is safe for Map/Set.
             */
            for (const id of cache.current.keys()) {
                if (!keep.has(id)) cache.current.delete(id);
            }
            for (const id of pending.current.keys()) {
                if (!keep.has(id)) pending.current.delete(id);
            }

            if (ids.length === 0) return;

            for (const id of ids) pending.current.add(id);

            getBatchThumbnailUrls(ids).then((urls) => {
                let addedVisible = false;
                for (const [id, url] of Object.entries(urls)) {
                    if (url) cache.current.set(id, url);
                    pending.current.delete(id);
                    if (url && visible.has(id)) addedVisible = true;
                }

                // Defensive LRU backstop (Map preserves insertion order, so the head
                // is the oldest). Window eviction usually keeps size well under the cap.
                if (cache.current.size > MAX_CACHE_ENTRIES) {
                    const overflow = cache.current.size - MAX_CACHE_ENTRIES;
                    let removed = 0;
                    for (const id of cache.current.keys()) {
                        if (removed++ >= overflow) break;
                        cache.current.delete(id);
                    }
                }

                /**
                 * Re-render only when a URL that just resolved belongs to a currently
                 * *visible* cell (P2).
                 *
                 * `thumbnailSrcFn` reads from a ref, so a version bump is the only way
                 * a resolved thumbnail can appear without the user scrolling — but
                 * bumping on every batch (including the off-screen margin fetched ahead
                 * during a fast scroll) re-rendered the whole grid each time, which
                 * drove the degrade phase. Off-screen resolutions need no bump: the
                 * scroll that brings them on-screen re-renders anyway and reads them
                 * straight from the cache.
                 */
                if (addedVisible) setVersion((v) => v + 1);
            }).catch(() => {
                for (const id of ids) pending.current.delete(id);
            });
        }, 150);

        return () => clearTimeout(timeoutId);
    }, [enabled, virtualRows, virtualizer.range?.startIndex, virtualizer.range?.endIndex]);

    return thumbnailSrcFn;
}
