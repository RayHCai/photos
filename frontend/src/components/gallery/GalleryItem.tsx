'use client';

import { memo, useMemo } from 'react';
import { PlayCircle, Star } from 'lucide-react';
import { thumbnailUrlFromKey } from '@/lib/api/media';
import { blurhashToDataUrl } from '@/lib/utils/blurhashCache';
import { formatDuration } from '@/lib/utils/format';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useSelectableItem } from '@/lib/hooks/useSelectableItem';
import type { MediaShellItem } from '@/lib/types/media';

interface GalleryItemProps {
    item: MediaShellItem;
    width: number;
    height: number;
    onClick: () => void;
    isSelected?: boolean;
    isSelecting?: boolean;
    isFavorite?: boolean;
    onToggleFavorite?: () => void;
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
    isFavorite,
    onToggleFavorite,
    onSelect,
    thumbnailSrc,
}: GalleryItemProps) {
    const { handleClick, handleContextMenu } = useSelectableItem({
        isSelecting,
        onSelect,
        onClick: item.processingStatus === 'COMPLETED' ? onClick : undefined,
    });

    const blurDataUrl = useMemo(
        () => (item.blurHash ? blurhashToDataUrl(item.blurHash) : null),
        [item.blurHash]
    );

    return (
        <div
            className={`relative overflow-hidden bg-stone-100 flex-shrink-0 group select-none ${
                item.processingStatus === 'COMPLETED' || isSelecting ? 'cursor-pointer' : 'cursor-default'
            }`}
            style={{
                width,
                height,
                ...(blurDataUrl && {
                    backgroundImage: `url(${blurDataUrl})`,
                    backgroundSize: 'cover',
                }),
            }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {item.processingStatus === 'COMPLETED' && item.thumbnailKey ? (
                <img
                    src={thumbnailSrc ?? thumbnailUrlFromKey(item.thumbnailKey, item.id)}
                    alt="Photo"
                    loading="lazy"
                    decoding="async"
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
                <div className="absolute bottom-1 right-1 flex items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {item.durationSeconds !== null && (
                        <span className="text-[11px] font-medium">{formatDuration(item.durationSeconds)}</span>
                    )}
                    <PlayCircle className="w-4 h-4" />
                </div>
            )}

            {onToggleFavorite && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite();
                    }}
                    className={`absolute top-1 left-1 p-0.5 rounded-full transition-opacity ${
                        isFavorite
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                >
                    <Star className={`w-4 h-4 ${
                        isFavorite
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-white/70'
                    }`} />
                </button>
            )}

            {onSelect && (
                <SelectionCheckbox isSelected={isSelected} isSelecting={isSelecting} onSelect={onSelect} />
            )}

        </div>
    );
});
