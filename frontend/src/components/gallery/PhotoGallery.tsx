'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { GalleryGrid } from './GalleryGrid';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import { Spinner } from '@/components/ui/Spinner';
import type { MediaListItem } from '@/lib/types/media';
import type { useMediaSelection } from '@/lib/hooks/useMediaSelection';

interface LightboxProps {
    mediaId: string;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
}

interface PhotoGalleryProps {
    items: MediaListItem[];
    isLoading?: boolean;
    emptyMessage?: string;

    // Infinite scroll
    hasMore?: boolean;
    fetchMore?: () => void;
    isFetching?: boolean;

    // Selection
    selection: ReturnType<typeof useMediaSelection>;

    // Custom thumbnail source (for shared links)
    thumbnailSrcFn?: (id: string) => string;

    // Custom lightbox renderer. Defaults to MediaLightbox.
    renderLightbox?: (props: LightboxProps) => ReactNode;
}

export function PhotoGallery({
    items,
    isLoading,
    emptyMessage = 'No photos',
    hasMore,
    fetchMore,
    isFetching,
    selection,
    thumbnailSrcFn,
    renderLightbox,
}: PhotoGalleryProps) {
    const [lightboxId, setLightboxId] = useState<string | null>(null);

    const lightboxIndex = lightboxId
        ? items.findIndex((i) => i.id === lightboxId)
        : -1;

    const handlePrev = useCallback(() => {
        if (lightboxIndex > 0) {
            setLightboxId(items[lightboxIndex - 1].id);
        }
    }, [lightboxIndex, items]);

    const handleNext = useCallback(() => {
        if (lightboxIndex < items.length - 1) {
            setLightboxId(items[lightboxIndex + 1].id);
        }
    }, [lightboxIndex, items]);

    const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

    const handleItemSelect = useCallback(
        (id: string, e: React.MouseEvent) => {
            if (!selection.isSelecting) selection.startSelecting();
            if (e.shiftKey) {
                selection.addRange(id, orderedIds);
            }
            else {
                selection.toggle(id);
            }
        },
        [selection, orderedIds]
    );

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Spinner className="w-6 h-6" />
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="font-serif text-stone-400 select-none">
                    {emptyMessage}
                </p>
            </div>
        );
    }

    const lightboxProps: LightboxProps | null = lightboxId
        ? {
            mediaId: lightboxId,
            onClose: () => setLightboxId(null),
            onPrev: lightboxIndex > 0 ? handlePrev : undefined,
            onNext:
                lightboxIndex < items.length - 1 ? handleNext : undefined,
        }
        : null;

    return (
        <>
            <div className="flex-1 min-h-0">
                <GalleryGrid
                    items={items}
                    onItemClick={(id) => setLightboxId(id)}
                    hasMore={hasMore}
                    fetchMore={fetchMore}
                    isFetching={isFetching}
                    selectedIds={selection.selectedIds}
                    isSelecting={selection.isSelecting}
                    onItemSelect={handleItemSelect}
                    thumbnailSrcFn={thumbnailSrcFn}
                />
            </div>

            {lightboxProps &&
                (renderLightbox ? (
                    renderLightbox(lightboxProps)
                ) : (
                    <MediaLightbox
                        mediaId={lightboxProps.mediaId}
                        onClose={lightboxProps.onClose}
                        onPrev={lightboxProps.onPrev}
                        onNext={lightboxProps.onNext}
                    />
                ))}
        </>
    );
}
