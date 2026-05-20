'use client';

import { useMemo, useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GalleryRow } from './GalleryRow';
import { DateHeader } from './DateHeader';
import { computeJustifiedLayout } from '@/lib/utils/imageLayout';
import { groupByDate } from '@/lib/utils/groupByDate';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import type { MediaListItem } from '@/lib/types/media';

interface VirtualRow {
    type: 'date-header' | 'gallery-row';
    height: number;
    label?: string;
    row?: ReturnType<typeof computeJustifiedLayout>[number];
    contentOffset?: number;
}

interface GalleryGridProps {
    items: MediaListItem[];
    onItemClick: (id: string) => void;
    hasMore?: boolean;
    fetchMore?: () => void;
    isFetching?: boolean;
    containerWidth?: number;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string;
}

export function GalleryGrid({
    items,
    onItemClick,
    hasMore,
    fetchMore,
    isFetching,
    containerWidth: propWidth,
    selectedIds,
    isSelecting,
    onItemSelect,
    thumbnailSrcFn,
}: GalleryGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [measuredWidth, setMeasuredWidth] = useState(0);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setMeasuredWidth(el.clientWidth);
        const observer = new ResizeObserver((entries) => {
            const width = Math.round(entries[0].contentRect.width);
            if (width > 0) setMeasuredWidth(width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const containerWidth = propWidth ?? measuredWidth;

    const mediaMap = useMemo(() => {
        const map = new Map<string, MediaListItem>();
        for (const item of items) {
            map.set(item.id, item);
        }
        return map;
    }, [items]);

    const virtualRows = useMemo(() => {
        if (containerWidth <= 0) return [];

        const groups = groupByDate(items);
        const rows: VirtualRow[] = [];

        const availableWidth = containerWidth - 132;

        for (const group of groups) {
            const layoutRows = computeJustifiedLayout(
                group.items.map((i) => ({
                    id: i.id,
                    width: i.width,
                    height: i.height,
                })),
                availableWidth,
                220,
                5
            );

            let maxRowWidth = 0;
            for (const row of layoutRows) {
                const rowWidth = row.items.reduce((sum, item) => sum + item.scaledWidth, 0) + (row.items.length - 1) * 5;
                maxRowWidth = Math.max(maxRowWidth, rowWidth);
            }
            const contentOffset = Math.max(0, (availableWidth - maxRowWidth) / 2);

            rows.push({
                type: 'date-header',
                height: 40,
                label: group.label,
                contentOffset,
            });

            for (const row of layoutRows) {
                rows.push({
                    type: 'gallery-row',
                    height: row.height + 5,
                    row,
                });
            }
        }

        return rows;
    }, [items, containerWidth]);

    const virtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: (index) => virtualRows[index]?.height || 220,
        overscan: 5,
    });

    useEffect(() => {
        virtualizer.measure();
    }, [virtualRows]);

    const handleFetchMore = useCallback(() => {
        if (fetchMore && !isFetching) {
            fetchMore();
        }
    }, [fetchMore, isFetching]);

    const sentinelRef = useInfiniteScroll(
        handleFetchMore,
        !!hasMore && !isFetching
    );

    return (
        <div
            ref={containerRef}
            className="h-full overflow-y-auto"
        >
            <div
                className="relative w-full px-4"
                style={{ height: virtualizer.getTotalSize() }}
            >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const row = virtualRows[virtualItem.index];
                    return (
                        <div
                            key={virtualItem.index}
                            className="absolute top-0 left-0 w-full px-[66px]"
                            style={{
                                height: virtualItem.size,
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                        >
                            {row.type === 'date-header' ? (
                                <DateHeader label={row.label!} contentOffset={row.contentOffset} />
                            ) : (
                                <GalleryRow
                                    row={row.row!}
                                    mediaItems={mediaMap}
                                    onItemClick={onItemClick}
                                    selectedIds={selectedIds}
                                    isSelecting={isSelecting}
                                    onItemSelect={onItemSelect}
                                    thumbnailSrcFn={thumbnailSrcFn}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            <div ref={sentinelRef} className="h-4" />

            {isFetching && (
                <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border border-stone-300 border-t-stone-900 rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
}
