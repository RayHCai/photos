'use client';

import { memo, useMemo, useState } from 'react';
import { PlayCircle, Star } from 'lucide-react';
import { CDN_CONFIGURED, thumbnailSrcSet, thumbnailUrlFromKey } from '@/lib/api/media';
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

    /**
     * Request CDN thumbnails with CORS so the service worker can read their status.
     * A no-cors response is opaque — status 0, `ok` false — whether it was a 200 or the
     * 404 a ladder variant returns before it has been generated, so the worker had no way
     * to avoid caching failures as images.
     *
     * Scoped to the CDN deliberately. The other two sources are same-origin endpoints that
     * 302 to S3 (`/media/:id/thumbnail`, and the share links that supply `thumbnailSrc`),
     * and a cross-origin redirect makes the browser send `Origin: null` on the second hop,
     * which no bucket allowlist can match — `anonymous` there would break the image
     * outright. Neither path is cacheable anyway: the worker skips redirected responses.
     */
    const useCors = CDN_CONFIGURED && !thumbnailSrc;

    /**
     * The srcset advertises every width in the ladder, but the ladder lives only in
     * S3 — no column records which rungs an item actually has, so an item processed
     * before a ladder fix (vertical sources used to lose their 800w rung) is missing
     * the candidate a large cell picks. The browser does not try another candidate
     * when the chosen one fails; it renders an empty cell.
     *
     * Dropping the srcset on error falls back to `src`, the canonical thumbnail,
     * which always exists. Slightly soft in a large cell, which beats blank.
     *
     * Keyed by thumbnailKey rather than a boolean so a recycled cell (this grid is
     * virtualised, components are reused across items) does not inherit the previous
     * item's failure.
     */
    const [ladderFailedFor, setLadderFailedFor] = useState<string | null>(null);
    const useSrcSet = !thumbnailSrc && ladderFailedFor !== item.thumbnailKey;

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
                    srcSet={useSrcSet ? thumbnailSrcSet(item.thumbnailKey!) : undefined}
                    sizes={`${Math.round(width)}px`}
                    /**
                     * Re-renders once with no srcset. If `src` itself is what failed,
                     * the state is already set to this key, so React bails out and no
                     * further request is made — no retry loop.
                     */
                    onError={() => setLadderFailedFor(item.thumbnailKey)}
                    crossOrigin={useCors ? 'anonymous' : undefined}
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
