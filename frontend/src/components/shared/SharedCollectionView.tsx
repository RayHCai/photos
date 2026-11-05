'use client';

import { useMemo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getSharedItems,
    getSharedTimeline,
    sharedThumbnailUrl,
    sharedOriginalUrl,
    sharedDownloadUrl,
    sharedArchiveUrl,
    sharedArchiveProgressBase,
} from '@/lib/api/share';
import { Download, History } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useDownload } from '@/lib/hooks/useDownload';
import { useWindowedMedia } from '@/lib/hooks/useWindowedMedia';
import { PhotoGallery, type LightboxConfig } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { GuestUpload } from './GuestUpload';
import { SharedActivityPanel } from './SharedActivityPanel';
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
    const { triggerArchive } = useDownload();
    const [activityOpen, setActivityOpen] = useState(false);

    // Not async: the form navigation must spend the click's user activation.
    const handleDownloadAll = useCallback(() => {
        triggerArchive(sharedArchiveUrl(slug), { progressBase: sharedArchiveProgressBase(slug) });
    }, [slug, triggerArchive]);

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
            {/* Laid out like the library's collection header: icons above the title on a phone. */}
            <header className="relative z-30 bg-stone-50 flex flex-col md:flex-row md:items-center px-4 md:px-6 py-4">
                <div className="hidden md:block flex-1" />
                <div className="order-last md:order-none min-w-0 md:max-w-[60%] mt-2 md:mt-0 text-center">
                    <h1 className="text-xl font-serif text-stone-900 truncate">
                        {collection.name}
                    </h1>
                    <p className="text-xs text-stone-400 mt-1">
                        {pluralize(collection.itemCount, 'item')}
                    </p>
                </div>
                <div className="relative md:static md:flex-1 h-9 flex items-center justify-end gap-1">
                    {!selection.isSelecting && (
                        <>
                            {collection.upload && (
                                <GuestUpload slug={slug} limits={collection.upload} />
                            )}
                            {collection.itemCount > 0 && (
                                <IconButton
                                    icon={Download}
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleDownloadAll}
                                    title="Download all"
                                />
                            )}
                            <IconButton
                                icon={History}
                                size="sm"
                                variant="ghost"
                                onClick={() => setActivityOpen(true)}
                                title="Activity"
                            />
                        </>
                    )}
                    <SelectionToolbar
                        selection={selection}
                        showDownload
                        downloadUrlFn={downloadUrlFn}
                        // A guest has no session, so the library's archive endpoint would
                        // answer 401. There is no public equivalent, so a multi-file
                        // download here stays a file-at-a-time fetch.
                        archiveUrlFn={null}
                    />
                </div>
            </header>

            <PhotoGallery
                items={windowed.items}
                isLoading={windowed.isLoading}
                emptyMessage={collection.upload ? 'No photos yet. Add yours.' : undefined}
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

            {/* Outside the header, so nothing in it can become the drawer's containing block. */}
            <SharedActivityPanel slug={slug} open={activityOpen} onClose={() => setActivityOpen(false)} />
        </div>
    );
}
