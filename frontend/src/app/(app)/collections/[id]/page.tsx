'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useCollection, useRemoveCollectionItems } from '@/lib/hooks/useCollections';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { CollectionSettingsModal } from '@/components/collections/CollectionSettingsModal';
import { CollectionActivityPanel } from '@/components/collections/CollectionActivityPanel';
import { SourceAttributionScope } from '@/lib/providers/SourceAttributionProvider';
import { useFilePicker } from '@/lib/hooks/useFilePicker';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { CenteredSpinner } from '@/components/ui/CenteredSpinner';
import { Button } from '@/components/ui/Button';
import { FileDropZone } from '@/components/upload/UploadDropzone';
import { UploadMenu } from '@/components/upload/UploadMenu';
import { Download, History, Settings } from 'lucide-react';
import { useDownload } from '@/lib/hooks/useDownload';
import { collectionArchiveUrl } from '@/lib/api/media';
import { pluralize } from '@/lib/utils/pluralize';
import { toast } from 'sonner';

export default function CollectionDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const {
        collection,
        items: mediaItems,
        timeline,
        windowStart,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isLoadingMore,
        fetchPreviousPage,
        hasPreviousPage,
        isLoadingPrevious,
        seekToIndex,
    } = useCollection(id);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activityOpen, setActivityOpen] = useState(false);

    // The upload email links here with ?activity=1, to land on the change log
    // where uploads are reviewed. Read once rather than through useSearchParams,
    // which would need a Suspense boundary for a value only the first render uses.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).has('activity')) setActivityOpen(true);
    }, []);
    const selection = useMediaSelection();
    useEscapeKey(selection.clearSelection, selection.isSelecting);
    const removeItems = useRemoveCollectionItems();
    const { openFilePicker, openFolderPicker } = useFilePicker();
    const { favoriteIds, addToFavorites, removeFromFavorites } = useFavorites();
    const { triggerArchive } = useDownload();

    // Not async: the form navigation must spend the click's user activation.
    const handleDownloadAll = useCallback(() => {
        triggerArchive(collectionArchiveUrl(id));
    }, [id, triggerArchive]);

    const handleToggleFavorite = useCallback((mediaId: string, isFavorite: boolean) => {
        if (isFavorite) {
            removeFromFavorites([mediaId]);
        }
        else {
            addToFavorites([mediaId]);
        }
    }, [addToFavorites, removeFromFavorites]);

    const handleRemoveItems = useCallback(async (ids: string[]) => {
        await new Promise<void>((resolve, reject) => {
            removeItems.mutate(
                { collectionId: id, mediaItemIds: ids },
                {
                    onSuccess: () => {
                        toast.success(`${pluralize(ids.length, 'item')} removed from collection`);
                        resolve();
                    },
                    onError: () => reject(),
                }
            );
        });
    }, [id, removeItems]);

    if (isLoading) {
        return <CenteredSpinner />;
    }

    if (!collection) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <p className="text-stone-500">Collection not found</p>
            </div>
        );
    }

    return (
        <FileDropZone className="h-[100dvh] flex flex-col">
            {/*
              * Toolbar. On a phone the icons take the top row beside the menu
              * button and the title gets a row of its own beneath them: side by
              * side, four icons ran into the title and pushed it off centre.
              */}
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between px-4 md:px-[30px] pt-4 md:pt-3 pb-5 md:pb-9">
                <div className="hidden md:block flex-1" />
                <div className="order-last md:order-none min-w-0 md:max-w-[60%] mt-2 md:mt-0 text-center">
                    <h1 className="text-xl font-serif text-stone-900 truncate">
                        {collection.name}
                    </h1>
                    {/* The true total, not the number of pages fetched so far. */}
                    <p className="text-xs text-stone-400 mt-0.5">
                        {pluralize(collection._count?.items ?? mediaItems.length, 'item')}
                    </p>
                </div>
                {/* Positioned on a phone so the selection toolbar centres on this row, not both. */}
                <div className="relative md:static md:flex-1 h-9 flex items-center justify-end gap-2">
                    <SelectionToolbar
                        selection={selection}
                        showAddToCollection
                        showShare
                        showDownload
                        onRemoveFromCollection={handleRemoveItems}
                        removeFromCollectionLoading={removeItems.isPending}
                    />
                    {!selection.isSelecting && (
                        <>
                            <UploadMenu
                                onUploadFiles={() => openFilePicker(id)}
                                onUploadFolder={() => openFolderPicker(id)}
                            />
                            {(collection._count?.items ?? mediaItems.length) > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleDownloadAll}
                                    title="Download all"
                                    aria-label="Download all"
                                >
                                    <Download className="w-4 h-4" />
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setActivityOpen(true)}
                                title="Activity"
                                aria-label="Activity"
                            >
                                <History className="w-4 h-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSettingsOpen(true)}
                            >
                                <Settings className="w-4 h-4" />
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Gallery — full home parity: windowed both ways + timeline seek. */}
            <SourceAttributionScope currentCollectionId={id}>
                <PhotoGallery
                    items={mediaItems}
                    selection={selection}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    timeline={timeline}
                    onLoadMore={fetchNextPage}
                    hasMore={hasNextPage}
                    isLoadingMore={isLoadingMore}
                    onLoadPrevious={fetchPreviousPage}
                    hasPrevious={hasPreviousPage}
                    isLoadingPrevious={isLoadingPrevious}
                    windowStart={windowStart}
                    onSeekToIndex={seekToIndex}
                />
            </SourceAttributionScope>

            <CollectionActivityPanel
                collectionId={id}
                open={activityOpen}
                onClose={() => setActivityOpen(false)}
            />

            <CollectionSettingsModal
                collectionId={id}
                collectionName={collection.name}
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </FileDropZone>
    );
}
