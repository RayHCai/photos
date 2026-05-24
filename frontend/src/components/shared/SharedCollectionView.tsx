'use client';

import { useMemo, useCallback } from 'react';
import { sharedThumbnailUrl, sharedOriginalUrl } from '@/lib/api/share';
import { PhotoGallery, type LightboxConfig } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { pluralize } from '@/lib/utils/pluralize';
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

    const lightboxConfig: LightboxConfig = useMemo(
        () => ({
            showDelete: false,
            showInfoPanel: false,
            urlFns: {
                thumbnail: (id: string) => sharedThumbnailUrl(slug, id),
                web: (id: string) => sharedOriginalUrl(slug, id),
                original: (id: string) => sharedOriginalUrl(slug, id),
                download: (id: string) => sharedOriginalUrl(slug, id),
            },
        }),
        [slug]
    );

    return (
        <div className="h-screen bg-stone-50 select-none flex flex-col">
            <header className="relative bg-stone-50 px-6 py-4">
                <h1 className="text-xl font-serif text-stone-900">
                    {collection.name}
                </h1>
                <p className="text-xs text-stone-400 mt-1">
                    {pluralize(collection.items.length, 'item')}
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
                lightboxConfig={lightboxConfig}
            />
        </div>
    );
}
