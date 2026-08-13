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
}

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

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setMeasuredWidth(el.clientWidth);

        let frame = 0;
        const observer = new ResizeObserver((entries) => {
            const width = Math.round(entries[0]!.contentRect.width);
            if (width <= 0) return;
            /**
             * rAF-coalesced. `containerWidth` feeds the layout memo, so an unthrottled
             * observer re-ran the grouping *and* computeJustifiedLayout — allocating
             * an object per photo — once per notification while a window edge was
             * being dragged.
             */
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setMeasuredWidth(width));
        });
        observer.observe(el);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, []);

    const containerWidth = propWidth ?? measuredWidth;
    const isMobile = containerWidth > 0 && containerWidth < MOBILE_BREAKPOINT;
    const mobileAvailableWidth = containerWidth - MOBILE_PADDING * 2;

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
            const availableWidth = containerWidth - MOBILE_PADDING * 2;
            const cellSize = Math.floor(
                (availableWidth - (mobileColumns - 1) * MOBILE_GAP) / mobileColumns
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
    }, [groups, containerWidth, isMobile, mobileColumns]);

    const virtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: (index) => virtualRows[index]?.height || (isMobile ? 100 : TARGET_ROW_HEIGHT),
        overscan: isMobile ? 3 : 5,
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

    useEffect(() => {
        virtualizer.measure();
        // Intentionally keyed on the row set only: depending on the virtualizer's
        // own identity would loop.
    }, [virtualRows]);

    return (
        <div className="h-full relative">
            <div
                ref={containerRef}
                className="h-full overflow-y-auto hide-scrollbar"
                style={isMobile ? { touchAction: 'pan-y' } : undefined}
            >
                <div
                    className="relative w-full"
                    style={{
                        height: virtualizer.getTotalSize(),
                        padding: isMobile ? `0 ${MOBILE_PADDING}px` : '0 4px',
                        // Live pinch feedback: scale the grid visually and commit a new
                        // column count on release, so no layout runs mid-gesture.
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
                    {virtualizer.getVirtualItems().map((virtualItem) => {
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
                                        ? `0 ${MOBILE_PADDING}px`
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

            <TimelineScrollbar
                containerRef={containerRef}
                virtualRows={virtualRows}
                timeline={timeline}
            />
        </div>
    );
}
