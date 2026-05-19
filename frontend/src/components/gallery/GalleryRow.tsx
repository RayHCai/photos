'use client';

import { memo } from 'react';
import { GalleryItem } from './GalleryItem';
import type { LayoutRow } from '@/lib/utils/imageLayout';
import type { MediaListItem } from '@/lib/types/media';

interface GalleryRowProps {
    row: LayoutRow;
    mediaItems: Map<string, MediaListItem>;
    onItemClick: (id: string) => void;
    selectedIds?: Set<string>;
    isSelecting?: boolean;
    onItemSelect?: (id: string, e: React.MouseEvent) => void;
    thumbnailSrcFn?: (id: string) => string;
}

export const GalleryRow = memo(function GalleryRow({
    row,
    mediaItems,
    onItemClick,
    selectedIds,
    isSelecting,
    onItemSelect,
    thumbnailSrcFn,
}: GalleryRowProps) {
    return (
        <div className="flex justify-center gap-[5px]" style={{ height: row.height }}>
            {row.items.map((item) => {
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
