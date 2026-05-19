'use client';

import { useMemo, useCallback } from 'react';
import { sharedThumbnailUrl, sharedOriginalUrl } from '@/lib/api/share';
import { X, Download } from 'lucide-react';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import type { SharedCollection } from '@/lib/types/share';

interface SharedCollectionViewProps {
    collection: SharedCollection;
    slug: string;
}

export function SharedCollectionView({
    collection,
    slug,
}: SharedCollectionViewProps) {
    const selection = useMediaSelection();

    const mediaItems = useMemo(
        () => collection.items.map((i) => i.mediaItem),
        [collection.items]
    );

    const thumbnailSrcFn = useCallback(
        (id: string) => sharedThumbnailUrl(slug, id),
        [slug]
    );

    const downloadUrlFn = useCallback(
        (id: string) => sharedOriginalUrl(slug, id),
        [slug]
    );

    const renderLightbox = useCallback(
        ({
            mediaId,
            onClose,
        }: {
            mediaId: string;
            onClose: () => void;
            onPrev?: () => void;
            onNext?: () => void;
        }) => {
            const item = mediaItems.find((i) => i.id === mediaId);
            if (!item) return null;
            return (
                <div
                    className="fixed inset-0 z-50 bg-stone-950 flex items-center justify-center"
                    onClick={onClose}
                >
                    <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                        <a
                            href={sharedOriginalUrl(slug, item.id)}
                            download={item.fileName}
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 rounded bg-black/40 text-white hover:bg-black/60 transition-colors"
                        >
                            <Download className="w-5 h-5" />
                        </a>
                        <button
                            onClick={onClose}
                            className="p-2 rounded bg-black/40 text-white hover:bg-black/60 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    {item.type === 'VIDEO' ? (
                        <video
                            src={sharedOriginalUrl(slug, item.id)}
                            controls
                            autoPlay
                            className="max-w-[90vw] max-h-[90vh]"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <img
                            src={sharedOriginalUrl(slug, item.id)}
                            alt={item.fileName}
                            className="max-w-[90vw] max-h-[90vh] object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                    )}
                </div>
            );
        },
        [slug, mediaItems]
    );

    return (
        <div className="h-screen bg-stone-50 select-none flex flex-col">
            <header className="relative bg-stone-50 px-6 py-4">
                <h1 className="text-xl font-serif text-stone-900">
                    {collection.name}
                </h1>
                {collection.description && (
                    <p className="text-sm text-stone-500 mt-1">
                        {collection.description}
                    </p>
                )}
                <p className="text-xs text-stone-400 mt-1">
                    {collection.items.length} item
                    {collection.items.length !== 1 ? 's' : ''}
                </p>
                <SelectionToolbar
                    selection={selection}
                    showDownload
                    downloadUrlFn={downloadUrlFn}
                />
            </header>

            <PhotoGallery
                items={mediaItems}
                selection={selection}
                thumbnailSrcFn={thumbnailSrcFn}
                renderLightbox={renderLightbox}
            />
        </div>
    );
}
