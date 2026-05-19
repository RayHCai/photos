'use client';

import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useCollection, useAddCollectionItems, useRemoveCollectionItems } from '@/lib/hooks/useCollections';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { CollectionItemPicker } from '@/components/collections/CollectionItemPicker';
import { CollectionSettingsModal } from '@/components/collections/CollectionSettingsModal';
import { CenteredSpinner } from '@/components/ui/CenteredSpinner';
import { Button } from '@/components/ui/Button';
import { Settings } from 'lucide-react';
import { toast } from 'sonner';

export default function CollectionDetailPage() {
    const params = useParams();
    const id = params.id as string;
    const { data: collection, isLoading } = useCollection(id);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const selection = useMediaSelection();
    const addItems = useAddCollectionItems();
    const removeItems = useRemoveCollectionItems();

    const handleRemoveItems = useCallback(async (ids: string[]) => {
        await new Promise<void>((resolve, reject) => {
            removeItems.mutate(
                { collectionId: id, mediaItemIds: ids },
                {
                    onSuccess: () => {
                        toast.success(`${ids.length} item${ids.length !== 1 ? 's' : ''} removed from collection`);
                        resolve();
                    },
                    onError: () => reject(),
                }
            );
        });
    }, [id, removeItems]);

    const mediaItems = useMemo(
        () => collection?.items.map((i) => i.mediaItem) || [],
        [collection]
    );

    const existingIds = useMemo(
        () => new Set(mediaItems.map((i) => i.id)),
        [mediaItems]
    );

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
        <div className="h-screen flex flex-col">
            {/* Toolbar */}
            <div className="relative flex items-center justify-between px-[30px] pt-3 pb-9">
                <div className="flex-1" />
                <div>
                    <h1 className="text-xl font-serif text-stone-900">
                        {collection.name}
                    </h1>
                    <p className="text-xs text-stone-400 mt-0.5">
                        {mediaItems.length} item
                        {mediaItems.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="flex-1 flex items-center justify-end gap-2">
                    <SelectionToolbar
                        selection={selection}
                        onDelete={handleRemoveItems}
                        deleteConfirmMessage={`Remove ${selection.count} item${selection.count !== 1 ? 's' : ''} from this collection? The files will not be deleted.`}
                        deleteLoading={removeItems.isPending}
                    />
                    {!selection.isSelecting && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSettingsOpen(true)}
                        >
                            <Settings className="w-4 h-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Gallery */}
            <PhotoGallery
                items={mediaItems}
                selection={selection}
            />

            <CollectionItemPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                excludeIds={existingIds}
                loading={addItems.isPending}
                onConfirm={(ids) => {
                    addItems.mutate(
                        { collectionId: id, mediaItemIds: ids },
                        {
                            onSuccess: () => {
                                setPickerOpen(false);
                                toast.success('Items added');
                            },
                        }
                    );
                }}
            />

            <CollectionSettingsModal
                collectionId={id}
                collectionName={collection.name}
                collectionDescription={collection.description}
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </div>
    );
}
