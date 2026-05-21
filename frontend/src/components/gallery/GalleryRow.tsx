'use client';

import { memo } from 'react';
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
                {rowData.row.items.map((item) => {
                    const mediaItem = mediaItems.get(item.id);
                    if (!mediaItem) return null;
                    return (
                        <GalleryItem
                            key={item.id}
                            item={mediaItem}
                            width={size}
                            height={size}
                            onClick={() => onItemClick(item.id)}
                            isSelected={selectedIds?.has(item.id)}
                            isSelecting={isSelecting}
                            onSelect={
                                onItemSelect
                                    ? (e: React.MouseEvent) => onItemSelect(item.id, e)
                                    : undefined
                            }
                            thumbnailSrc={thumbnailSrcFn ? thumbnailSrcFn(item.id) : undefined}
                        />
                    );
                })}
            </div>
        );
    }

    // Justified layout (desktop)
    return (
        <div className="flex justify-center gap-[5px]" style={{ height: rowData.row.height }}>
            {rowData.row.items.map((item) => {
                const mediaItem = mediaItems.get(item.id);
                if (!mediaItem) return null;
                return (
                    <GalleryItem
                        key={item.id}
                        item={mediaItem}
                        width={item.scaledWidth}
                        height={item.scaledHeight}
                        onClick={() => onItemClick(item.id)}
                        isSelected={selectedIds?.has(item.id)}
                        isSelecting={isSelecting}
                        onSelect={
                            onItemSelect
                                ? (e: React.MouseEvent) => onItemSelect(item.id, e)
                                : undefined
                        }
                        thumbnailSrc={thumbnailSrcFn ? thumbnailSrcFn(item.id) : undefined}
                    />
                );
            })}
        </div>
    );
});
