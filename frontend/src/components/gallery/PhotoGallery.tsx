'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { GalleryGrid } from './GalleryGrid';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import { Spinner } from '@/components/ui/Spinner';
import { useLightboxNavigation } from '@/lib/hooks/useLightboxNavigation';
import type { MediaShellItem } from '@/lib/types/media';
import type { useMediaSelection } from '@/lib/hooks/useMediaSelection';

interface LightboxProps {
    mediaId: string;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
}

interface PhotoGalleryProps {
    items: MediaShellItem[];
    isLoading?: boolean;
    emptyMessage?: string;

    // Selection
    selection: ReturnType<typeof useMediaSelection>;

    // Custom thumbnail source (for shared links)
    thumbnailSrcFn?: (id: string) => string | undefined;

    // Custom lightbox renderer. Defaults to MediaLightbox.
    renderLightbox?: (props: LightboxProps) => ReactNode;
}

export function PhotoGallery({
    items,
    isLoading,
    emptyMessage = 'No photos',
    selection,
    thumbnailSrcFn,
    renderLightbox,
}: PhotoGalleryProps) {
    const [lightboxId, setLightboxId] = useState<string | null>(null);

    const { onPrev, onNext } = useLightboxNavigation(items, lightboxId, setLightboxId);

    const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

    const handleItemSelect = useCallback(
        (id: string, e: React.MouseEvent) => {
            selection.handleSelect(id, orderedIds, e);
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
            onPrev,
            onNext,
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
