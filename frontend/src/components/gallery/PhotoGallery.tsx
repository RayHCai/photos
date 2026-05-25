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

    // Match the visual order produced by GalleryGrid's groupByDate sorting
    const visualItems = useMemo(() => groupByDate(items).flatMap((g) => g.items), [items]);

    const { onPrev, onNext, prevMediaId, nextMediaId } = useLightboxNavigation(visualItems, lightboxId, setLightboxId);

    const orderedIds = useMemo(() => visualItems.map((i) => i.id), [visualItems]);

    const handleItemSelect = useCallback(
        (id: string, e: React.MouseEvent) => {
            selection.handleSelect(id, orderedIds, e);
        },
        [selection, orderedIds]
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
                    items={items}
                    onItemClick={(id) => setLightboxId(id)}
                    selectedIds={selection.selectedIds}
                    isSelecting={selection.isSelecting}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={onToggleFavorite}
                    onItemSelect={handleItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                    timeline={timeline}
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
