'use client';

import { memo } from 'react';
import { Play, Check } from 'lucide-react';
import { thumbnailUrl } from '@/lib/api/media';
import { formatDuration } from '@/lib/utils/format';
import type { MediaListItem } from '@/lib/types/media';

interface GalleryItemProps {
    item: MediaListItem;
    width: number;
    height: number;
    onClick: () => void;
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
    thumbnailSrc?: string;
}

export const GalleryItem = memo(function GalleryItem({
    item,
    width,
    height,
    onClick,
    isSelected,
    isSelecting,
    onSelect,
    thumbnailSrc,
}: GalleryItemProps) {
    const handleClick = (e: React.MouseEvent) => {
        if (isSelecting && onSelect) {
            onSelect(e);
        }
        else if (item.processingStatus === 'COMPLETED') {
            onClick();
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (onSelect) {
            e.preventDefault();
            onSelect(e);
        }
    };

    return (
        <div
            className={`relative overflow-hidden bg-stone-100 flex-shrink-0 group select-none ${
                item.processingStatus === 'COMPLETED' || isSelecting ? 'cursor-pointer' : 'cursor-default'
            }`}
            style={{ width, height }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {item.processingStatus === 'COMPLETED' && item.thumbnailKey ? (
                <img
                    src={thumbnailSrc ?? thumbnailUrl(item.id)}
                    alt={item.fileName}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    draggable={false}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                    {item.processingStatus === 'FAILED'
                        ? 'Failed'
                        : 'Processing...'}
                </div>
            )}

            {item.type === 'VIDEO' && (
                <div className="absolute bottom-1 right-1 flex items-center gap-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-sm">
                    <Play className="w-3 h-3" />
                    {item.durationSeconds !== null &&
                        formatDuration(item.durationSeconds)}
                </div>
            )}

            {onSelect && (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(e);
                    }}
                    className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-none border-2 flex items-center justify-center cursor-pointer transition-all ${
                        isSelected
                            ? 'bg-stone-900 border-stone-900'
                            : 'border-white bg-black/20'
                    } ${isSelecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
            )}

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
        </div>
    );
});
