'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { PlayCircle, Star } from 'lucide-react';
import { CDN_CONFIGURED, thumbnailSrcSet, thumbnailUrlFromKey } from '@/lib/api/media';
import { blurhashAverageColor, blurhashToDataUrl } from '@/lib/utils/blurhashCache';
import { formatDuration } from '@/lib/utils/format';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useSelectableItem } from '@/lib/hooks/useSelectableItem';
import type { MediaShellItem } from '@/lib/types/media';

/** Failures before the one retry: 1 drops the srcset, 2 means `src` itself failed. */
const RETRY_AFTER_FAILURES = 2;
const RETRY_DELAY_MS = 1200;
const RETRY_JITTER_MS = 1800;

/**
 * Cell width below which the blurhash is rendered as a flat average colour instead of a
 * decoded gradient. A cell this small cannot resolve a 32x32 gradient, so the two look
 * the same and only one of them costs a canvas encode.
 */
const FLAT_PLACEHOLDER_MAX_CELL_PX = 120;

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

    /**
     * Gradient placeholder for a cell big enough to show one; a flat average colour
     * below that. See blurhashAverageColor for why the cheap path exists — the gradient
     * costs a canvas round trip and a PNG encode per *unique* hash, which scrolling
     * forward misses by construction, and a dense mobile grid mounts a hundred new cells
     * a screenful.
     */
    const useFlatPlaceholder = width < FLAT_PLACEHOLDER_MAX_CELL_PX;

    const blurDataUrl = useMemo(
        () => (item.blurHash && !useFlatPlaceholder ? blurhashToDataUrl(item.blurHash) : null),
        [item.blurHash, useFlatPlaceholder]
    );

    const blurColor = useMemo(
        () => (item.blurHash && useFlatPlaceholder ? blurhashAverageColor(item.blurHash) : null),
        [item.blurHash, useFlatPlaceholder]
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
    const baseSrc = thumbnailSrc ?? thumbnailUrlFromKey(item.thumbnailKey, item.id);

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
     * Dropping the srcset on the first error falls back to `src`, the canonical
     * thumbnail, which always exists. Slightly soft in a large cell, which beats blank.
     *
     * Beyond that first step this used to be terminal: a second error set the same state
     * value, React bailed out, no attribute changed, and no further request was ever
     * made. That turned every *transient* failure into a permanent one — and on a phone
     * they are not rare, since a dropped packet, a cancelled load, or a service worker
     * too busy to answer all surface here as an error. The cell then sat on its blurhash
     * background for as long as it stayed mounted, which is exactly the reported
     * stuck-blurred thumbnail. One backed-off retry recovers those without turning a
     * genuinely missing object into a retry loop.
     *
     * Keyed by thumbnailKey rather than a counter alone, so a cell that is re-used for a
     * different item does not inherit the previous one's failures.
     */
    const [failures, setFailures] = useState<{ key: string | null; count: number }>({
        key: null,
        count: 0,
    });
    const failureCount = failures.key === item.thumbnailKey ? failures.count : 0;
    const useSrcSet = !thumbnailSrc && failureCount === 0;

    /**
     * Cache-buster for the retry attempt.
     *
     * Only the browser's own HTTP cache needs busting: it is what can hold a CDN error
     * response stamped `immutable`, and the service worker strips the query when it
     * builds its cache key, so a retry still hits any bytes already stored there.
     *
     * Never applied to a caller-supplied `thumbnailSrc`. In presigned mode (and on share
     * links) that is a signed S3 URL whose query is part of what was signed, so an extra
     * parameter turns a working image into a 403. Those URLs also expire and are
     * re-issued, which gives that path its own recovery.
     */
    const canRetry = !thumbnailSrc;
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        if (!canRetry || failureCount !== RETRY_AFTER_FAILURES) return;
        // Jittered, because a stall fails a whole screenful of cells at once and they
        // must not all come back at the same instant into the congestion that caused it.
        const delay = RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS;
        const timer = setTimeout(() => setRetryToken((t) => t + 1), delay);
        return () => clearTimeout(timer);
    }, [canRetry, failureCount]);

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
                ...(blurColor && { backgroundColor: blurColor }),
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
                    src={baseSrc + (retryToken > 0 ? `${baseSrc.includes('?') ? '&' : '?'}r=${retryToken}` : '')}
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
                     * First failure re-renders once with no srcset, falling back to
                     * `src`. A second means `src` itself failed, which arms the single
                     * backed-off retry above. Past that the count keeps rising but
                     * nothing reads it, so there is no retry loop.
                     */
                    onError={() =>
                        setFailures((prev) => ({
                            key: item.thumbnailKey,
                            count: prev.key === item.thumbnailKey ? prev.count + 1 : 1,
                        }))
                    }
                    crossOrigin={useCors ? 'anonymous' : undefined}
                    alt={item.fileName ?? (item.type === 'VIDEO' ? 'Video' : 'Photo')}
                    loading="lazy"
                    decoding="async"
                    /**
                     * Explicit decode dimensions (the measured cell size). The cell is
                     * still sized by CSS (`object-cover`, `w-full h-full`), but giving
                     * the browser exact intrinsic dimensions lets it size the decoded
                     * bitmap to the cell instead of the source's own resolution, and
                     * evict it more readily — both of which cut the GPU/decode working
                     * set under fast scroll.
                     */
                    width={Math.round(width)}
                    height={Math.round(height)}
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
