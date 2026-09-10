'use client';

import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getSharedItems,
    getSharedTimeline,
    sharedThumbnailUrl,
    sharedOriginalUrl,
    sharedDownloadUrl,
} from '@/lib/api/share';
import { useWindowedMedia } from '@/lib/hooks/useWindowedMedia';
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

    /**
     * Items are windowed exactly like the authenticated gallery — a large public
     * link used to hold its whole album in guest memory. The scrollbar is driven by
     * a public, hidden-excluded timeline endpoint; passing it as an array (never
     * undefined) also stops the scrollbar from falling back to the authenticated
     * `/media/timeline`, which a guest cannot call.
     */
    const windowed = useWindowedMedia({
        queryKey: ['share', slug, 'items'],
        fetchPage: ({ offset, limit }) => getSharedItems(slug, { offset, limit }),
    });

    const { data: timeline } = useQuery({
        queryKey: ['share', slug, 'timeline'],
        queryFn: () => getSharedTimeline(slug),
        staleTime: 60_000,
    });

    const thumbnailSrcFn = useCallback(
        (id: string) => sharedThumbnailUrl(slug, id),
        [slug]
    );

    const downloadUrlFn = useCallback(
        (id: string) => sharedDownloadUrl(slug, id),
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
                download: (id: string) => sharedDownloadUrl(slug, id),
            },
        }),
        [slug]
    );

    return (
        <div className="h-[100dvh] bg-stone-50 select-none flex flex-col">
            <header className="relative bg-stone-50 px-6 py-4">
                <h1 className="text-xl font-serif text-stone-900">
                    {collection.name}
                </h1>
                <p className="text-xs text-stone-400 mt-1">
                    {pluralize(collection.itemCount, 'item')}
                </p>
                <SelectionToolbar
                    selection={selection}
                    showDownload
                    downloadUrlFn={downloadUrlFn}
                    // A guest has no session, so the library's archive endpoint would
                    // answer 401. There is no public equivalent, so a multi-file
                    // download here stays a file-at-a-time fetch.
                    archiveUrlFn={null}
                />
            </header>

            <PhotoGallery
                items={windowed.items}
                isLoading={windowed.isLoading}
                selection={selection}
                thumbnailSrcFn={thumbnailSrcFn}
                lightboxConfig={lightboxConfig}
                timeline={timeline ?? []}
                onLoadMore={windowed.fetchNextPage}
                hasMore={windowed.hasNextPage}
                isLoadingMore={windowed.isLoadingMore}
                onLoadPrevious={windowed.fetchPreviousPage}
                hasPrevious={windowed.hasPreviousPage}
                isLoadingPrevious={windowed.isLoadingPrevious}
                windowStart={windowed.windowStart}
                onSeekToIndex={windowed.seekToIndex}
            />
        </div>
    );
}
