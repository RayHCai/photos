'use client';

import { useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GalleryRow } from './GalleryRow';
import { DateHeader } from './DateHeader';
import { computeJustifiedLayout, type LayoutRow } from '@/lib/utils/imageLayout';
import { TimelineScrollbar } from './TimelineScrollbar';
import { useThumbnailPrefetch } from '@/lib/hooks/useThumbnailPrefetch';
import { usePinchToZoom } from '@/lib/hooks/usePinchToZoom';
import { useDragSelect, type DragSelectController } from '@/lib/hooks/useDragSelect';
import { useHasTouch } from '@/lib/hooks/useIsMobile';
import { CDN_CONFIGURED } from '@/lib/api/media';
import {
    DATE_HEADER_HEIGHT,
    DESKTOP_GAP,
    DESKTOP_INSET,
    MOBILE_BREAKPOINT,
    MOBILE_GAP,
    MOBILE_PADDING,
    MOBILE_SCROLLBAR_GUTTER,
    TARGET_ROW_HEIGHT,
} from '@/lib/constants/layout';
import type { DateGroup } from '@/lib/utils/groupByDate';
import type { MediaShellItem } from '@/lib/types/media';

export interface GridRow {
    items: Array<{ id: string }>;
    cellSize: number;
}

export type GalleryRowData =
    | { mode: 'justified'; row: LayoutRow }
    | { mode: 'grid'; row: GridRow };

export interface VirtualRow {
    /** Stable identity for the virtualizer, independent of array position. */
    key: string;
    type: 'date-header' | 'gallery-row';
    height: number;
    label?: string;
    date?: string;
    rowData?: GalleryRowData;
    contentOffset?: number;
}

interface GalleryGridProps {
    /** Pre-grouped by day. Grouping happens once, in PhotoGallery. */
    groups: DateGroup<MediaShellItem>[];
    onItemClick: (id: string) => void;
    containerWidth?: number;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    favoriteIds?: Set<string>;
    onToggleFavorite?: (id: string, isFavorite: boolean) => void;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
    timeline?: import('@/lib/types/media').TimelineMonth[];
    /** Enables press-and-drag multi-select + edge auto-scroll on touch devices. */
    dragSelect?: DragSelectController;
    /** Called when the scroll position nears the end of the loaded rows. */
    onLoadMore?: () => void;
    /** Whether a further page exists beyond what's currently loaded. */
    hasMore?: boolean;
    /** Whether a page fetch triggered by onLoadMore is in flight. */
    isLoadingMore?: boolean;
    /** Called when the scroll position nears the start of the loaded window. */
    onLoadPrevious?: () => void;
    /** Whether a page exists above the loaded window. */
    hasPrevious?: boolean;
    /** Whether a page fetch triggered by onLoadPrevious is in flight. */
    isLoadingPrevious?: boolean;
    /** Global index of the first loaded item; the window's absolute start. */
    windowStart?: number;
    /** Lets a timeline jump load the page holding an item index directly. */
    onSeekToIndex?: (index: number) => Promise<void>;
}

/**
 * How close to the end of the loaded rows a fetch is triggered, as a multiple of
 * the viewport height.
 *
 * Measured in pixels rather than rows on purpose. A row-count threshold meant a
 * 2000-item page had to be scrolled to within ~10 of its ~400 rows — about 97% of
 * the way down — before the next page was even requested, so scrolling dead-ended
 * at the bottom of each page and waited for a round trip. Three viewports of
 * lookahead keeps the next page arriving before the user can reach the end.
 */
const LOAD_MORE_VIEWPORT_LOOKAHEAD = 3;

/**
 * Rows mounted beyond the viewport, expressed in pixels rather than rows.
 *
 * The virtualizer counts overscan in *rows*, which made the lookahead collapse exactly
 * where it was needed most: a mobile row is `cellSize + gap`, so three rows is ~576px at
 * two columns but only ~192px at six. At six columns a flick therefore mounted a row,
 * started its thumbnail request, and unmounted it again — cancelling the load — before
 * the response could arrive, so a fast scroll could cross hundreds of photos while
 * finishing none of them and leaving every cell on its blurhash.
 *
 * A pixel budget also keeps decoded-image memory flat rather than growing it, which is
 * the concern the row count was protecting: cells shrink as columns grow, so the same
 * strip of pixels costs roughly the same decoded bytes at any density. 576px is the
 * two-column value, so that case is unchanged.
 */
const OVERSCAN_LOOKAHEAD_PX = 576;
/**
 * Second ceiling, in cells rather than pixels, because the two costs of an overscanned
 * row are not the same shape.
 *
 * Decoded memory tracks *pixels*, and a pixel budget holds it flat as cells shrink. But
 * every mounted cell also issues a network request, and that cost tracks the cell COUNT,
 * which grows with the square of the column count. Honouring the pixel budget alone would
 * mount ten overscan rows at six columns — sixty cells per side against six at two
 * columns — and fire them all at once on a mobile link. Since the reported symptom is
 * thumbnails not arriving, a tenfold increase in simultaneous requests is the wrong
 * direction to push, whatever it does for decode memory.
 *
 * This caps the request burst while still buying back most of the lookahead the row-count
 * overscan lost at high densities.
 */
const MAX_OVERSCAN_CELLS_PER_SIDE = 30;
/** Ceiling on the derived row overscan, so a pathologically short row cannot run away. */
const MAX_OVERSCAN_ROWS = 10;

export function GalleryGrid({
    groups,
    onItemClick,
    containerWidth: propWidth,
    selectedIds,
    isSelecting,
    favoriteIds,
    onToggleFavorite,
    onItemSelect,
    thumbnailSrcFn,
    timeline,
    dragSelect,
    onLoadMore,
    hasMore,
    isLoadingMore,
    onLoadPrevious,
    hasPrevious,
    isLoadingPrevious,
    windowStart = 0,
    onSeekToIndex,
}: GalleryGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const hasTouch = useHasTouch();

    // Seed with the viewport width so the first synchronous render already produces
    // rows (and mounts thumbnails) instead of emitting zero rows until the post-mount
    // ResizeObserver fires. Slightly overestimates (ignores the sidebar), which only
    // affects the transient first paint before the layout effect corrects it.
    const [measuredWidth, setMeasuredWidth] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth : 0
    );
    /**
     * Observed rather than read from `clientHeight` during render.
     *
     * The load-more lookaheads need the viewport height, and reading it off the DOM in
     * the render body forced a synchronous layout flush on every scroll-driven render —
     * interleaved with the virtualizer's own DOM writes, which is the read-after-write
     * pattern that produces layout thrash on the one thread the scroll depends on.
     */
    const [measuredHeight, setMeasuredHeight] = useState(0);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setMeasuredWidth(el.clientWidth);
        setMeasuredHeight(el.clientHeight);

        let frame = 0;
        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0]!.contentRect;
            if (width <= 0) return;
            /**
             * rAF-coalesced. `containerWidth` feeds the layout memo, so an unthrottled
             * observer re-ran the grouping *and* computeJustifiedLayout — allocating
             * an object per photo — once per notification while a window edge was
             * being dragged.
             */
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                setMeasuredWidth(Math.round(width));
                setMeasuredHeight(Math.round(height));
            });
        });
        observer.observe(el);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, []);

    const containerWidth = propWidth ?? measuredWidth;
    const isMobile = containerWidth > 0 && containerWidth < MOBILE_BREAKPOINT;

    /**
     * One source for the mobile insets.
     *
     * The cell arithmetic and the row's own padding have to agree exactly: the rows carry
     * `contain: layout style paint`, so a row whose flex children total more than its
     * content box is silently *clipped* rather than visibly overflowing, with no
     * horizontal scrollbar to give it away. Deriving both from the same pair means the
     * gutter cannot half-land.
     */
    const mobileInsetLeft = MOBILE_PADDING;
    const mobileInsetRight = MOBILE_PADDING + MOBILE_SCROLLBAR_GUTTER;
    const mobileAvailableWidth = containerWidth - mobileInsetLeft - mobileInsetRight;

    const { columns: mobileColumns, gestureScale, isPinching } = usePinchToZoom(
        containerRef,
        isMobile,
        mobileAvailableWidth,
        MOBILE_GAP
    );

    // Press-and-drag multi-select with edge auto-scroll. Coexists with pinch-to-zoom
    // above — it bails out the moment a second finger lands. Gated on pointer type
    // rather than width, so iPads and touch laptops get it too.
    useDragSelect(containerRef, hasTouch, dragSelect);

    const mediaMap = useMemo(() => {
        const map = new Map<string, MediaShellItem>();
        for (const group of groups) {
            for (const item of group.items) map.set(item.id, item);
        }
        return map;
    }, [groups]);

    /**
     * Row layout.
     *
     * The live pinch scale is deliberately NOT a dependency. It used to be, and it is
     * updated from a rAF on every touchmove — so each frame of the gesture re-ran the
     * entire library's layout, then cascaded into virtualizer.measure(), the
     * prefetcher re-arming, and the timeline scrollbar rebuilding its date index while
     * reading clientHeight. On a mid-range phone with 20k photos the gesture did not
     * animate at all: the grid froze, then snapped to a new density seconds after the
     * fingers lifted.
     *
     * The gesture is now purely visual (a CSS transform on the container) and only the
     * committed `mobileColumns` triggers a re-layout.
     */
    const virtualRows = useMemo<VirtualRow[]>(() => {
        if (containerWidth <= 0) return [];

        const rows: VirtualRow[] = [];

        if (isMobile) {
            const cellSize = Math.floor(
                (mobileAvailableWidth - (mobileColumns - 1) * MOBILE_GAP) / mobileColumns
            );

            for (const group of groups) {
                rows.push({
                    key: `header:${group.date}`,
                    type: 'date-header',
                    height: DATE_HEADER_HEIGHT,
                    label: group.label,
                    date: group.date,
                });

                for (let i = 0; i < group.items.length; i += mobileColumns) {
                    const chunk = group.items.slice(i, i + mobileColumns);
                    rows.push({
                        // Keyed by the first item, so identity survives insertions
                        // above it in the list.
                        key: `row:${chunk[0]!.id}`,
                        type: 'gallery-row',
                        height: cellSize + MOBILE_GAP,
                        rowData: {
                            mode: 'grid',
                            row: { items: chunk.map((item) => ({ id: item.id })), cellSize },
                        },
                    });
                }
            }
        }
        else {
            const availableWidth = containerWidth - DESKTOP_INSET * 2;

            for (const group of groups) {
                const layoutRows = computeJustifiedLayout(
                    group.items.map((i) => ({ id: i.id, width: i.width, height: i.height })),
                    availableWidth,
                    TARGET_ROW_HEIGHT,
                    DESKTOP_GAP
                );

                let maxRowWidth = 0;
                for (const row of layoutRows) {
                    const rowWidth =
                        row.items.reduce((sum, item) => sum + item.scaledWidth, 0) +
                        (row.items.length - 1) * DESKTOP_GAP;
                    maxRowWidth = Math.max(maxRowWidth, rowWidth);
                }
                const contentOffset = Math.max(0, (availableWidth - maxRowWidth) / 2);

                rows.push({
                    key: `header:${group.date}`,
                    type: 'date-header',
                    height: DATE_HEADER_HEIGHT,
                    label: group.label,
                    date: group.date,
                    contentOffset,
                });

                for (const row of layoutRows) {
                    rows.push({
                        key: `row:${row.items[0]?.id ?? group.date}`,
                        type: 'gallery-row',
                        height: row.height + DESKTOP_GAP,
                        rowData: { mode: 'justified', row },
                    });
                }
            }
        }

        return rows;
    }, [groups, containerWidth, isMobile, mobileColumns, mobileAvailableWidth]);

    /**
     * Overscan, derived from the row height so the lookahead is a fixed strip of pixels.
     * Desktop keeps the literal 3: its rows are already ~225px, so the pixel budget is
     * met and the tighter margin the comment below describes is preserved.
     */
    const overscan = useMemo(() => {
        if (!isMobile || mobileColumns <= 0 || mobileAvailableWidth <= 0) return 3;
        const cellSize = Math.floor(
            (mobileAvailableWidth - (mobileColumns - 1) * MOBILE_GAP) / mobileColumns
        );
        const rowHeight = cellSize + MOBILE_GAP;
        if (rowHeight <= 0) return 3;
        const byPixels = Math.ceil(OVERSCAN_LOOKAHEAD_PX / rowHeight);
        const byCells = Math.floor(MAX_OVERSCAN_CELLS_PER_SIDE / mobileColumns);
        return Math.max(3, Math.min(MAX_OVERSCAN_ROWS, byPixels, byCells));
    }, [isMobile, mobileColumns, mobileAvailableWidth]);

    const virtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: (index) => virtualRows[index]?.height || (isMobile ? 100 : TARGET_ROW_HEIGHT),
        // Budgeted in pixels, not rows — see OVERSCAN_LOOKAHEAD_PX. Every overscanned
        // row decodes its thumbnails into the GPU working set even though it is
        // off-screen, which is why this is a fixed strip of pixels rather than a fixed
        // row count: cells shrink as columns grow, so the decoded cost of the strip stays
        // roughly constant instead of tracking the row count. Desktop is unchanged.
        overscan,
        /**
         * Stable keys. The rows were previously keyed by array index, so any insertion
         * or removal above the viewport — a new upload, a delete, a hide, a
         * column-count change — shifted every index and handed each row entirely
         * different content. React then unmounted and remounted every visible cell
         * with brand-new <img> elements, discarding decoded bitmaps; combined with the
         * processing poll the grid visibly flashed every few seconds.
         */
        getItemKey: (index) => virtualRows[index]?.key ?? index,
    });

    // With a CDN configured, GalleryItem builds thumbnail URLs directly from each
    // item's key — no batch round-trip and no version-bump re-render storm. Keep the
    // prefetch only as the presigned-mode fallback (and whenever a caller supplies its
    // own thumbnailSrcFn, e.g. shared links).
    const prefetchSrcFn = useThumbnailPrefetch(
        virtualRows,
        virtualizer,
        !thumbnailSrcFn && !CDN_CONFIGURED
    );
    const resolvedThumbnailSrcFn = thumbnailSrcFn ?? (CDN_CONFIGURED ? undefined : prefetchSrcFn);

    /*
     * There is deliberately no `virtualizer.measure()` effect here.
     *
     * It cleared a measurement cache that this grid never populates — `measureElement` is
     * never called, so row positions come entirely from `estimateSize` — and the memo it
     * was meant to invalidate is invalidated anyway: `getItemKey` and `estimateSize` are
     * fresh closures on every render, which is part of the virtualizer's own memo key. So
     * it was pure cost: `measure()` notifies unconditionally, forcing a second full render
     * of the grid immediately after every one that changed the row set — every page slide,
     * every column change, every processing-poll patch.
     */

    /**
     * Keep the viewport pinned to the same content when the window slides.
     *
     * The window is a fixed span of pages: scrolling down evicts the top page and
     * scrolling up prepends one. Either way the row set above the viewport changes,
     * so every remaining row shifts and — because the browser keeps `scrollTop`
     * numerically fixed — the content under the user would jump. This corrects for
     * it by measuring the row straddling the top edge before and after the change
     * and adjusting `scrollTop` by the exact delta.
     *
     * Heights are exact (justified layout is a pure function of the stored
     * dimensions), so this is a correction, not an estimate. A jump replaces the
     * whole window, so its anchor key is gone — the effect no-ops and the scrollbar
     * lands the jump itself. Runs in a layout effect so the fix lands before paint.
     */
    const prevRowsRef = useRef<VirtualRow[] | null>(null);
    useLayoutEffect(() => {
        const container = containerRef.current;
        const prev = prevRowsRef.current;
        prevRowsRef.current = virtualRows;
        if (!container || !prev || prev === virtualRows) return;

        const scrollTop = container.scrollTop;
        if (scrollTop <= 0) return; // pinned to the top: nothing above to preserve

        // New-layout start offset for every row key, for O(1) survivor lookup.
        const newOffsets = new Map<string, number>();
        let nacc = 0;
        for (const r of virtualRows) {
            newOffsets.set(r.key, nacc);
            nacc += r.height;
        }

        /**
         * Walk the OLD rows from the top edge downward and re-anchor to the *first*
         * one that still exists in the new layout, keeping it at the same viewport
         * position it held before (`newOff - (oldOff - scrollTop)`).
         *
         * A window slide leaves the straddling top-edge row intact, so this lands on
         * it exactly like the previous single-anchor version. But an invalidation
         * that shifted the source — a delete or hide *above* a deep window — replaces
         * that row's identity; anchoring instead to the nearest surviving row below
         * keeps the jump to a fraction of a row rather than no-op'ing and letting the
         * browser hold scrollTop fixed over content that moved by a whole page. If
         * nothing survives (the whole window was replaced, i.e. a jump) it falls
         * through and the scrollbar lands the jump itself.
         */
        let oldOff = 0;
        let reachedTopEdge = false;
        for (const r of prev) {
            if (oldOff + r.height > scrollTop) reachedTopEdge = true;
            if (reachedTopEdge) {
                const newOff = newOffsets.get(r.key);
                if (newOff !== undefined) {
                    const next = newOff - (oldOff - scrollTop);
                    if (next !== scrollTop) container.scrollTop = next;
                    return;
                }
            }
            oldOff += r.height;
        }
    }, [virtualRows]);

    const virtualItems = virtualizer.getVirtualItems();

    /**
     * Fetch the next page while the end of the loaded rows is still a few viewports
     * away, so scrolling never stalls at a page boundary.
     *
     * Recomputed per render, which the virtualizer already triggers on scroll.
     */
    const totalSize = virtualizer.getTotalSize();
    const scrollOffset = virtualizer.scrollOffset ?? 0;
    const viewportHeight = measuredHeight;
    const distanceToEnd = totalSize - scrollOffset - viewportHeight;

    useEffect(() => {
        if (!hasMore || isLoadingMore || totalSize <= 0) return;
        if (distanceToEnd <= viewportHeight * LOAD_MORE_VIEWPORT_LOOKAHEAD) {
            onLoadMore?.();
        }
    }, [distanceToEnd, viewportHeight, totalSize, hasMore, isLoadingMore, onLoadMore]);

    /**
     * Mirror of the above for the top edge: once the window has slid down (front
     * pages evicted), scrolling back up refetches the page above before reaching
     * it. The re-anchor effect keeps the viewport still as the page prepends.
     */
    useEffect(() => {
        if (!hasPrevious || isLoadingPrevious || totalSize <= 0) return;
        if (scrollOffset <= viewportHeight * LOAD_MORE_VIEWPORT_LOOKAHEAD) {
            onLoadPrevious?.();
        }
    }, [scrollOffset, viewportHeight, totalSize, hasPrevious, isLoadingPrevious, onLoadPrevious]);

    return (
        <div className="h-full relative">
            <div
                ref={containerRef}
                className="h-full overflow-y-auto hide-scrollbar"
                style={{
                    // Keep a fling from chaining into the document behind the gallery,
                    // which on an iOS standalone PWA both wastes the gesture and can hand
                    // it to the system at the bottom edge.
                    overscrollBehavior: 'contain',
                    ...(isMobile && { touchAction: 'pan-y' }),
                }}
            >
                <div
                    className="relative w-full"
                    style={{ height: virtualizer.getTotalSize() }}
                >
                    {/*
                      * The pinch preview transform lives here, on an inner wrapper, not on
                      * the height-bearing div above.
                      *
                      * A scroll container's scrollable region includes its descendants'
                      * *transformed* boxes, so scaling the element that carries
                      * `getTotalSize()` scaled the scroll height itself. Pinching out to a
                      * denser grid is fingers-together — scale below 1 — so the scroll
                      * height halved mid-gesture and the browser clamped `scrollTop` to
                      * the new maximum. Anyone past the halfway point of the window was
                      * dragged backwards, and nothing recorded where they had been, so the
                      * re-anchor on release faithfully restored the clamped position
                      * rather than the real one.
                      */}
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            ...(gestureScale !== null && {
                                transform: `scale(${gestureScale})`,
                                transformOrigin: 'top center',
                            }),
                            // Only hinted during an actual gesture. It used to be set
                            // permanently on every row, promoting a compositor layer with a
                            // device-pixel backing store for each one on an already
                            // memory-tight iOS tab.
                            ...(isPinching && { willChange: 'transform' }),
                        }}
                    >
                        {virtualItems.map((virtualItem) => {
                            const row = virtualRows[virtualItem.index];
                            if (!row) return null;
                            return (
                                <div
                                    key={virtualItem.key}
                                    className="absolute top-0 left-0 w-full"
                                    style={{
                                        height: virtualItem.size,
                                        transform: `translateY(${virtualItem.start}px)`,
                                        padding: isMobile
                                            ? `0 ${mobileInsetRight}px 0 ${mobileInsetLeft}px`
                                            : `0 ${DESKTOP_INSET}px`,
                                        contain: 'layout style paint',
                                    }}
                                >
                                    {row.type === 'date-header' ? (
                                        <DateHeader
                                            label={row.label!}
                                            contentOffset={row.contentOffset}
                                        />
                                    ) : (
                                        <GalleryRow
                                            rowData={row.rowData!}
                                            mediaItems={mediaMap}
                                            onItemClick={onItemClick}
                                            selectedIds={selectedIds}
                                            isSelecting={isSelecting}
                                            favoriteIds={favoriteIds}
                                            onToggleFavorite={onToggleFavorite}
                                            onItemSelect={onItemSelect}
                                            thumbnailSrcFn={resolvedThumbnailSrcFn}
                                            hasTouch={hasTouch}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/*
              * Jumping to a month whose page is not loaded yet pulls those pages
              * first, so this can run for a beat on a long jump.
              */}
            {isLoadingMore && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-stone-800/80 text-white text-xs font-sans px-3 py-1.5 rounded-full shadow-lg">
                    Loading more…
                </div>
            )}

            <TimelineScrollbar
                containerRef={containerRef}
                virtualRows={virtualRows}
                timeline={timeline}
                hasMore={hasMore}
                onLoadMore={onLoadMore}
                windowStart={windowStart}
                onSeekToIndex={onSeekToIndex}
            />
        </div>
    );
}
