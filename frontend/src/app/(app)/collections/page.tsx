'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useCollections, useCreateCollection, useDeleteCollection } from '@/lib/hooks/useCollections';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useSearchFilter } from '@/lib/hooks/useSearchFilter';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { CollectionCard } from '@/components/collections/CollectionCard';
import { CollectionForm } from '@/components/collections/CollectionForm';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { PageContainer } from '@/components/layout/PageContainer';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { SearchInput } from '@/components/ui/SearchInput';
import { pluralize } from '@/lib/utils/pluralize';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function CollectionsPage() {
    const router = useRouter();
    const { data: collections, isLoading } = useCollections();
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const selection = useMediaSelection();
    const createCollection = useCreateCollection();
    const deleteCollection = useDeleteCollection();

    useEscapeKey(selection.clearSelection, selection.isSelecting);
    const filteredCollections = useSearchFilter(collections, search, useCallback((c) => c.name, []));
    const collectionIds = useMemo(() => filteredCollections.map((c) => c.id), [filteredCollections]);

    const handleDeleteCollections = useCallback(async (ids: string[]) => {
        try {
            await Promise.all(ids.map((id) => deleteCollection.mutateAsync(id)));
            toast.success(`Deleted ${pluralize(ids.length, 'collection')}`);
        }
        catch {
            toast.error('Failed to delete');
        }
    }, [deleteCollection]);

    return (
        <>
            <PageContainer
                isLoading={isLoading}
                isEmpty={!filteredCollections || filteredCollections.length === 0}
                emptyMessage="No collections"
                toolbar={
                    <>
                        <div className="flex-1 flex justify-center">
                            <SearchInput
                                value={search}
                                onChange={setSearch}
                                placeholder="Search collections"
                            />
                        </div>
                        <SelectionToolbar
                            selection={selection}
                            onDelete={handleDeleteCollections}
                            deleteConfirmMessage={`Delete ${selection.count} selected collection${selection.count !== 1 ? 's' : ''}? This cannot be undone.`}
                        />
                        <IconButton
                            icon={Plus}
                            onClick={() => setCreateOpen(true)}
                            title="New collection"
                            className="flex-shrink-0"
                        />
                    </>
                }
            >
                <div className="px-[34px] pb-6 flex flex-wrap justify-center gap-4">
                    {filteredCollections.map((c) => (
                        <div key={c.id} className="w-[200px]">
                            <CollectionCard
                                collection={c}
                                isSelected={selection.selectedIds.has(c.id)}
                                isSelecting={selection.isSelecting}
                                onSelect={(e: React.MouseEvent) => selection.handleSelect(c.id, collectionIds, e)}
                            />
                        </div>
                    ))}
                </div>
            </PageContainer>

            <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Collection">
                <CollectionForm
                    onSubmit={(data) => {
                        createCollection.mutate(data, {
                            onSuccess: (collection) => {
                                setCreateOpen(false);
                                toast.success('Collection created');
                                router.push(`/collections/${collection.id}`);
                            },
                            onError: () => {
                                toast.error('Failed to create collection');
                            },
                        });
                    }}
                    loading={createCollection.isPending}
                />
            </Dialog>
        </>
    );
}
