'use client';

import { useMemo, useRef, useState, useLayoutEffect, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GalleryRow } from './GalleryRow';
import { DateHeader } from './DateHeader';
import { computeJustifiedLayout, type LayoutRow } from '@/lib/utils/imageLayout';
import { groupByDate } from '@/lib/utils/groupByDate';
import { TimelineScrollbar } from './TimelineScrollbar';
import { useThumbnailPrefetch } from '@/lib/hooks/useThumbnailPrefetch';
import type { MediaShellItem } from '@/lib/types/media';

const MOBILE_BREAKPOINT = 768;
const MOBILE_COLUMNS = 4;
const MOBILE_GAP = 2;
const MOBILE_PADDING = 4;

export interface GridRow {
    items: Array<{ id: string }>;
    cellSize: number;
}

export type GalleryRowData =
    | { mode: 'justified'; row: LayoutRow }
    | { mode: 'grid'; row: GridRow };

export interface VirtualRow {
    type: 'date-header' | 'gallery-row';
    height: number;
    label?: string;
    date?: string;
    rowData?: GalleryRowData;
    contentOffset?: number;
}

interface GalleryGridProps {
    items: MediaShellItem[];
    onItemClick: (id: string) => void;
    containerWidth?: number;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}

export function GalleryGrid({
    items,
    onItemClick,
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
    const isMobile = containerWidth > 0 && containerWidth < MOBILE_BREAKPOINT;

    const mediaMap = useMemo(() => {
        const map = new Map<string, MediaShellItem>();
        for (const item of items) {
            map.set(item.id, item);
        }
        return map;
    }, [items]);

    const virtualRows = useMemo(() => {
        if (containerWidth <= 0) return [];

        const groups = groupByDate(items);
        const rows: VirtualRow[] = [];

        if (isMobile) {
            const availableWidth = containerWidth - MOBILE_PADDING * 2;
            const cellSize = Math.floor((availableWidth - (MOBILE_COLUMNS - 1) * MOBILE_GAP) / MOBILE_COLUMNS);

            for (const group of groups) {
                rows.push({
                    type: 'date-header',
                    height: 40,
                    label: group.label,
                    date: group.date,
                });

                for (let i = 0; i < group.items.length; i += MOBILE_COLUMNS) {
                    const chunk = group.items.slice(i, i + MOBILE_COLUMNS);
                    rows.push({
                        type: 'gallery-row',
                        height: cellSize + MOBILE_GAP,
                        rowData: {
                            mode: 'grid',
                            row: {
                                items: chunk.map((item) => ({ id: item.id })),
                                cellSize,
                            },
                        },
                    });
                }
            }
        }
        else {
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
                    date: group.date,
                    contentOffset,
                });

                for (const row of layoutRows) {
                    rows.push({
                        type: 'gallery-row',
                        height: row.height + 5,
                        rowData: { mode: 'justified', row },
                    });
                }
            }
        }

        return rows;
    }, [items, containerWidth, isMobile]);

    const virtualizer = useVirtualizer({
        count: virtualRows.length,
        getScrollElement: () => containerRef.current,
        estimateSize: (index) => virtualRows[index]?.height || (isMobile ? 100 : 220),
        overscan: isMobile ? 15 : 5,
    });

    const prefetchSrcFn = useThumbnailPrefetch(virtualRows, virtualizer, !thumbnailSrcFn);
    const resolvedThumbnailSrcFn = thumbnailSrcFn ?? prefetchSrcFn;

    useEffect(() => {
        virtualizer.measure();
    }, [virtualRows]);

    return (
        <div className="h-full relative">
            <div
                ref={containerRef}
                className="h-full overflow-y-auto hide-scrollbar"
            >
                <div
                    className="relative w-full"
                    style={{
                        height: virtualizer.getTotalSize(),
                        padding: isMobile ? `0 ${MOBILE_PADDING}px` : '0 4px',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const row = virtualRows[virtualItem.index];
                        return (
                            <div
                                key={virtualItem.index}
                                className="absolute top-0 left-0 w-full"
                                style={{
                                    height: virtualItem.size,
                                    transform: `translateY(${virtualItem.start}px)`,
                                    padding: isMobile ? `0 ${MOBILE_PADDING}px` : '0 66px',
                                }}
                            >
                                {row.type === 'date-header' ? (
                                    <DateHeader label={row.label!} contentOffset={row.contentOffset} />
                                ) : (
                                    <GalleryRow
                                        rowData={row.rowData!}
                                        mediaItems={mediaMap}
                                        onItemClick={onItemClick}
                                        selectedIds={selectedIds}
                                        isSelecting={isSelecting}
                                        onItemSelect={onItemSelect}
                                        thumbnailSrcFn={resolvedThumbnailSrcFn}
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
            />
        </div>
    );
}
