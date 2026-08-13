'use client';

import { memo, useCallback } from 'react';
import { GalleryItem } from './GalleryItem';
import { mobileGapStyle, desktopGapStyle } from '@/lib/constants/layout';
import type { GalleryRowData } from './GalleryGrid';
import type { MediaShellItem } from '@/lib/types/media';

interface RowItemProps {
    id: string;
    width: number;
    height: number;
    mediaItems: Map<string, MediaShellItem>;
    onItemClick: (id: string) => void;
    /** Precomputed, so a Set identity change does not re-render every cell. */
    isSelected: boolean;
    isSelecting?: boolean;
    isFavorite: boolean;
    onToggleFavorite?: (id: string, isFavorite: boolean) => void;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string | undefined;
    hasTouch?: boolean;
}

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
    /** Coarse pointer, so hover-only affordances are suppressed. */
    hasTouch?: boolean;
}

/**
 * `isSelected` and `isFavorite` arrive as booleans rather than as the Sets they come
 * from.
 *
 * Selection state is a brand-new Set on every change, so passing the Set down meant
 * `memo` compared a different reference every time and re-rendered every visible
 * cell on every selection toggle — which during a touch drag-paint is once per frame
 * across the whole viewport. Resolving membership in the row (which re-renders
 * anyway) means only the cells whose own bit actually changed re-render.
 */
const RowItem = memo(function RowItem({
    id,
    width,
    height,
    mediaItems,
    onItemClick,
    isSelected,
    isSelecting,
    isFavorite,
    onToggleFavorite,
    onItemSelect,
    thumbnailSrcFn,
    hasTouch,
}: RowItemProps) {
    const mediaItem = mediaItems.get(id);
    const handleClick = useCallback(() => onItemClick(id), [onItemClick, id]);
    const handleSelect = useCallback(
        (e: React.MouseEvent) => onItemSelect?.(id, e),
        [onItemSelect, id]
    );
    const handleToggleFavorite = useCallback(
        () => onToggleFavorite?.(id, isFavorite),
        [onToggleFavorite, id, isFavorite]
    );

    if (!mediaItem) return null;

    return (
        <GalleryItem
            item={mediaItem}
            width={width}
            height={height}
            onClick={handleClick}
            isSelected={isSelected}
            isSelecting={isSelecting}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite ? handleToggleFavorite : undefined}
            onSelect={onItemSelect ? handleSelect : undefined}
            thumbnailSrc={thumbnailSrcFn ? thumbnailSrcFn(id) : undefined}
            hasTouch={hasTouch}
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
    hasTouch,
}: GalleryRowProps) {
    const isGrid = rowData.mode === 'grid';

    // Gap styles come from the same constants the virtualizer's height maths uses,
    // rather than a Tailwind class that could drift from it.
    const items = isGrid
        ? rowData.row.items.map((item) => ({
            id: item.id,
            width: rowData.row.cellSize,
            height: rowData.row.cellSize,
        }))
        : rowData.row.items.map((item) => ({
            id: item.id,
            width: item.scaledWidth,
            height: item.scaledHeight,
        }));

    return (
        <div
            className={isGrid ? 'flex' : 'flex justify-center'}
            style={{
                height: isGrid ? rowData.row.cellSize : rowData.row.height,
                ...(isGrid ? mobileGapStyle : desktopGapStyle),
            }}
        >
            {items.map((item) => (
                <RowItem
                    key={item.id}
                    id={item.id}
                    width={item.width}
                    height={item.height}
                    mediaItems={mediaItems}
                    onItemClick={onItemClick}
                    isSelected={selectedIds?.has(item.id) ?? false}
                    isSelecting={isSelecting}
                    isFavorite={favoriteIds?.has(item.id) ?? false}
                    onToggleFavorite={onToggleFavorite}
                    onItemSelect={onItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                    hasTouch={hasTouch}
                />
            ))}
        </div>
    );
});
