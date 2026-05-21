'use client';

import { memo, useCallback } from 'react';
import { GalleryItem } from './GalleryItem';
import type { GalleryRowData } from './GalleryGrid';
import type { MediaShellItem } from '@/lib/types/media';

interface GalleryRowProps {
    rowData: GalleryRowData;
    mediaItems: Map<string, MediaShellItem>;
    onItemClick: (id: string) => void;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}

const GridItem = memo(function GridItem({
    id,
    mediaItems,
    size,
    onItemClick,
    selectedIds,
    isSelecting,
    onItemSelect,
    thumbnailSrcFn,
}: {
    id: string;
    mediaItems: Map<string, MediaShellItem>;
    size: number;
    onItemClick: (id: string) => void;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}) {
    const mediaItem = mediaItems.get(id);
    const handleClick = useCallback(() => onItemClick(id), [onItemClick, id]);
    const handleSelect = useCallback(
        (e: React.MouseEvent) => onItemSelect?.(id, e),
        [onItemSelect, id],
    );

    if (!mediaItem) return null;

    return (
        <GalleryItem
            item={mediaItem}
            width={size}
            height={size}
            onClick={handleClick}
            isSelected={selectedIds?.has(id)}
            isSelecting={isSelecting}
            onSelect={onItemSelect ? handleSelect : undefined}
            thumbnailSrc={thumbnailSrcFn ? thumbnailSrcFn(id) : undefined}
        />
    );
});

const JustifiedItem = memo(function JustifiedItem({
    id,
    scaledWidth,
    scaledHeight,
    mediaItems,
    onItemClick,
    selectedIds,
    isSelecting,
    onItemSelect,
    thumbnailSrcFn,
}: {
    id: string;
    scaledWidth: number;
    scaledHeight: number;
    mediaItems: Map<string, MediaShellItem>;
    onItemClick: (id: string) => void;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}) {
    const mediaItem = mediaItems.get(id);
    const handleClick = useCallback(() => onItemClick(id), [onItemClick, id]);
    const handleSelect = useCallback(
        (e: React.MouseEvent) => onItemSelect?.(id, e),
        [onItemSelect, id],
    );

    if (!mediaItem) return null;

    return (
        <GalleryItem
            item={mediaItem}
            width={scaledWidth}
            height={scaledHeight}
            onClick={handleClick}
            isSelected={selectedIds?.has(id)}
            isSelecting={isSelecting}
            onSelect={onItemSelect ? handleSelect : undefined}
            thumbnailSrc={thumbnailSrcFn ? thumbnailSrcFn(id) : undefined}
        />
    );
});

export const GalleryRow = memo(function GalleryRow({
    rowData,
    mediaItems,
    onItemClick,
    selectedIds,
    isSelecting,
    onItemSelect,
    thumbnailSrcFn,
}: GalleryRowProps) {
    if (rowData.mode === 'grid') {
        const size = rowData.row.cellSize;
        return (
            <div className="flex gap-[2px]" style={{ height: size }}>
                {rowData.row.items.map((item) => (
                    <GridItem
                        key={item.id}
                        id={item.id}
                        mediaItems={mediaItems}
                        size={size}
                        onItemClick={onItemClick}
                        selectedIds={selectedIds}
                        isSelecting={isSelecting}
                        onItemSelect={onItemSelect}
                        thumbnailSrcFn={thumbnailSrcFn}
                    />
                ))}
            </div>
        );
    }

    // Justified layout (desktop)
    return (
        <div className="flex justify-center gap-[5px]" style={{ height: rowData.row.height }}>
            {rowData.row.items.map((item) => (
                <JustifiedItem
                    key={item.id}
                    id={item.id}
                    scaledWidth={item.scaledWidth}
                    scaledHeight={item.scaledHeight}
                    mediaItems={mediaItems}
                    onItemClick={onItemClick}
                    selectedIds={selectedIds}
                    isSelecting={isSelecting}
                    onItemSelect={onItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                />
            ))}
        </div>
    );
});
