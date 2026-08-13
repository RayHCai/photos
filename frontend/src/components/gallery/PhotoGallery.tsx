'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { GalleryGrid } from './GalleryGrid';
import { MediaLightbox, type MediaLightboxProps } from '@/components/media/MediaLightbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { useLightboxNavigation } from '@/lib/hooks/useLightboxNavigation';
import { groupByDate } from '@/lib/utils/groupByDate';
import type { MediaShellItem } from '@/lib/types/media';
import type { useMediaSelection } from '@/lib/hooks/useMediaSelection';

/** Navigation props built by PhotoGallery; the rest come from lightboxConfig. */
type LightboxProps = Pick<MediaLightboxProps, 'mediaId' | 'onClose' | 'onPrev' | 'onNext' | 'prevMediaId' | 'nextMediaId' | 'mediaType'>;

/** Extra config forwarded to MediaLightbox (URL overrides, feature flags). */
export type LightboxConfig = Pick<MediaLightboxProps, 'showDelete' | 'showInfoPanel' | 'urlFns'>;

interface PhotoGalleryProps {
    items: MediaShellItem[];
    isLoading?: boolean;
    emptyMessage?: string;

    // Selection
    selection: ReturnType<typeof useMediaSelection>;

    // Favorite item IDs
    favoriteIds?: Set<string>;

    // Called when a user clicks the favorite star on an item
    onToggleFavorite?: (id: string, isFavorite: boolean) => void;

    // Custom thumbnail source (for shared links)
    thumbnailSrcFn?: (id: string) => string | undefined;

    // Custom lightbox renderer. Defaults to MediaLightbox.
    renderLightbox?: (props: LightboxProps) => ReactNode;

    /** Extra config forwarded to MediaLightbox (e.g. shared URL fns, hide delete). */
    lightboxConfig?: LightboxConfig;

    /** Override timeline data for the scrollbar (e.g. collection-scoped). */
    timeline?: import('@/lib/types/media').TimelineMonth[];
}

export function PhotoGallery({
    items,
    isLoading,
    emptyMessage = 'No photos',
    selection,
    favoriteIds,
    onToggleFavorite,
    thumbnailSrcFn,
    renderLightbox,
    lightboxConfig,
    timeline,
}: PhotoGalleryProps) {
    const [lightboxId, setLightboxId] = useState<string | null>(null);

    /**
     * Grouped once, here, and passed down to GalleryGrid.
     *
     * Both components used to call groupByDate(items) independently — two separate
     * memo caches invalidated by the same input, so every change walked the whole
     * library twice.
     */
    const groups = useMemo(() => groupByDate(items), [items]);

    // The visual order the grid will render, which is what lightbox navigation and
    // shift-range selection must agree with.
    const visualItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

    const { onPrev, onNext, prevMediaId, nextMediaId } = useLightboxNavigation(
        visualItems,
        lightboxId,
        setLightboxId
    );

    const orderedIds = useMemo(() => visualItems.map((i) => i.id), [visualItems]);

    /**
     * id -> visual index, built once per ordering change.
     *
     * Range selection and touch drag-paint previously called
     * `orderedIds.indexOf(...)` — twice per touchmove event, each a linear scan of
     * the entire library. At 50k items that is 100k string comparisons per frame,
     * which is why the selection highlight lagged hundreds of milliseconds behind
     * the finger.
     */
    const indexById = useMemo(() => {
        const map = new Map<string, number>();
        orderedIds.forEach((id, i) => map.set(id, i));
        return map;
    }, [orderedIds]);

    const handleItemSelect = useCallback(
        (id: string, e: React.MouseEvent) => {
            selection.handleSelect(id, orderedIds, indexById, e);
        },
        [selection, orderedIds, indexById]
    );

    // Bridge the touch drag-select gesture (resolved in GalleryGrid) to the
    // selection paint API. Stable across renders as long as the selection methods
    // and visual order hold, so listeners are not re-registered mid-gesture.
    const { beginDrag, updateDrag, endDrag } = selection;
    const dragSelect = useMemo(
        () => ({
            begin: (id: string) => beginDrag(id),
            update: (id: string) => updateDrag(id, orderedIds, indexById),
            end: () => endDrag(),
        }),
        [beginDrag, updateDrag, endDrag, orderedIds, indexById]
    );

    if (isLoading || items.length === 0) {
        return <EmptyState isLoading={isLoading} message={emptyMessage} />;
    }

    const currentItem = lightboxId ? visualItems.find((i) => i.id === lightboxId) : null;

    const lightboxProps: LightboxProps | null = lightboxId
        ? {
            mediaId: lightboxId,
            onClose: () => setLightboxId(null),
            onPrev,
            onNext,
            prevMediaId,
            nextMediaId,
            mediaType: currentItem?.type,
        }
        : null;

    return (
        <>
            <div className="flex-1 min-h-0">
                <GalleryGrid
                    groups={groups}
                    onItemClick={(id) => setLightboxId(id)}
                    selectedIds={selection.selectedIds}
                    isSelecting={selection.isSelecting}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={onToggleFavorite}
                    onItemSelect={handleItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                    timeline={timeline}
                    dragSelect={dragSelect}
                />
            </div>

            {lightboxProps &&
                (renderLightbox ? (
                    renderLightbox(lightboxProps)
                ) : (
                    <MediaLightbox
                        {...lightboxProps}
                        {...lightboxConfig}
                    />
                ))}
        </>
    );
}
