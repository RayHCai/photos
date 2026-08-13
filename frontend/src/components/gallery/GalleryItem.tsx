'use client';

import { memo, useMemo } from 'react';
import { PlayCircle, Star } from 'lucide-react';
import { thumbnailSrcSet, thumbnailUrlFromKey } from '@/lib/api/media';
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
    /** True when the primary pointer is coarse, so hover affordances are useless. */
    hasTouch?: boolean;
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
    hasTouch = false,
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

    /**
     * The favourite star is hover-revealed on desktop. A touch device has no hover,
     * so an `opacity-0` overlay stayed invisible while remaining fully hit-testable —
     * an invisible button in the corner of every thumbnail that silently favourited a
     * photo instead of opening it. On touch it appears only when already set or while
     * selecting, where the intent is unambiguous.
     */
    const showFavourite = onToggleFavorite && (!hasTouch || isFavorite || isSelecting);

    const isReady = item.processingStatus === 'COMPLETED' && item.thumbnailKey;

    return (
        <div
            data-media-id={item.id}
            className={`relative overflow-hidden bg-stone-100 flex-shrink-0 group select-none ${
                item.processingStatus === 'COMPLETED' || isSelecting
                    ? 'cursor-pointer'
                    : 'cursor-default'
            }`}
            style={{
                width,
                height,
                // Suppress the iOS long-press "Save Image" callout so it does not
                // hijack the drag-to-select long press.
                WebkitTouchCallout: 'none',
                ...(blurDataUrl && {
                    backgroundImage: `url(${blurDataUrl})`,
                    backgroundSize: 'cover',
                }),
            }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {isReady ? (
                <img
                    src={thumbnailSrc ?? thumbnailUrlFromKey(item.thumbnailKey!, item.id)}
                    /**
                     * Without srcset the same 400px file served every cell from ~63
                     * CSS px (mobile, 6 columns) up to ~400, across DPR 1-3 — so on a
                     * retina phone every thumbnail was upscaled and visibly soft,
                     * while a dense grid downloaded roughly 4x more pixels than it
                     * could show. `sizes` is the measured cell width, which is exact
                     * here because the layout is computed rather than CSS-driven.
                     */
                    srcSet={thumbnailSrc ? undefined : thumbnailSrcSet(item.thumbnailKey!)}
                    sizes={`${Math.round(width)}px`}
                    alt={item.fileName ?? (item.type === 'VIDEO' ? 'Video' : 'Photo')}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    draggable={false}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                    {item.processingStatus === 'FAILED' ? 'Failed' : 'Processing...'}
                </div>
            )}

            {item.type === 'VIDEO' && (
                <div className="absolute bottom-1 right-1 flex items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {item.durationSeconds !== null && (
                        <span className="text-[11px] font-medium">
                            {formatDuration(item.durationSeconds)}
                        </span>
                    )}
                    <PlayCircle className="w-4 h-4" aria-hidden="true" />
                </div>
            )}

            {showFavourite && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite();
                    }}
                    className={`absolute top-1 left-1 p-0.5 rounded-full transition-opacity ${
                        isFavorite || hasTouch
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    }`}
                    title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                    aria-label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                    aria-pressed={isFavorite}
                >
                    <Star
                        className={`w-4 h-4 ${
                            isFavorite ? 'fill-amber-400 text-amber-400' : 'text-white/70'
                        }`}
                        aria-hidden="true"
                    />
                </button>
            )}

            {onSelect && (
                <SelectionCheckbox
                    isSelected={isSelected}
                    isSelecting={isSelecting}
                    onSelect={onSelect}
                />
            )}
        </div>
    );
});
