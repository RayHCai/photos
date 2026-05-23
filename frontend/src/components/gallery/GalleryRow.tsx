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
    favoriteIds?: Set<string>;
    onToggleFavorite?: (id: string, isFavorite: boolean) => void;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}

const RowItem = memo(function RowItem({
    id,
    width,
    height,
    mediaItems,
    onItemClick,
    selectedIds,
    isSelecting,
    favoriteIds,
    onToggleFavorite,
    onItemSelect,
    thumbnailSrcFn,
}: {
    id: string;
    width: number;
    height: number;
    mediaItems: Map<string, MediaShellItem>;
    onItemClick: (id: string) => void;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    favoriteIds?: Set<string>;
    onToggleFavorite?: (id: string, isFavorite: boolean) => void;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
}) {
    const mediaItem = mediaItems.get(id);
    const handleClick = useCallback(() => onItemClick(id), [onItemClick, id]);
    const handleSelect = useCallback(
        (e: React.MouseEvent) => onItemSelect?.(id, e),
        [onItemSelect, id],
    );
    const isFavorite = favoriteIds?.has(id) ?? false;
    const handleToggleFavorite = useCallback(
        () => onToggleFavorite?.(id, isFavorite),
        [onToggleFavorite, id, isFavorite],
    );

    if (!mediaItem) return null;

    return (
        <GalleryItem
            item={mediaItem}
            width={width}
            height={height}
            onClick={handleClick}
            isSelected={selectedIds?.has(id)}
            isSelecting={isSelecting}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite ? handleToggleFavorite : undefined}
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
    favoriteIds,
    onToggleFavorite,
    onItemSelect,
    thumbnailSrcFn,
}: GalleryRowProps) {
    if (rowData.mode === 'grid') {
        const size = rowData.row.cellSize;
        return (
            <div className="flex gap-[2px]" style={{ height: size }}>
                {rowData.row.items.map((item) => (
                    <RowItem
                        key={item.id}
                        id={item.id}
                        width={size}
                        height={size}
                        mediaItems={mediaItems}
                        onItemClick={onItemClick}
                        selectedIds={selectedIds}
                        isSelecting={isSelecting}
                        favoriteIds={favoriteIds}
                        onToggleFavorite={onToggleFavorite}
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
                <RowItem
                    key={item.id}
                    id={item.id}
                    width={item.scaledWidth}
                    height={item.scaledHeight}
                    mediaItems={mediaItems}
                    onItemClick={onItemClick}
                    selectedIds={selectedIds}
                    isSelecting={isSelecting}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={onToggleFavorite}
                    onItemSelect={onItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                />
            ))}
        </div>
    );
});
