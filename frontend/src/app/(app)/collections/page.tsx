'use client';

import { useState, useCallback, useMemo } from 'react';
import { useCollections, useDeleteCollection } from '@/lib/hooks/useCollections';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useSearchFilter } from '@/lib/hooks/useSearchFilter';
import { CollectionCard } from '@/components/collections/CollectionCard';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { PageContainer } from '@/components/layout/PageContainer';
import { SearchInput } from '@/components/ui/SearchInput';
import { toast } from 'sonner';

export default function CollectionsPage() {
    const { data: collections, isLoading } = useCollections();
    const [search, setSearch] = useState('');
    const selection = useMediaSelection();
    const deleteCollection = useDeleteCollection();

    const filteredCollections = useSearchFilter(collections, search, useCallback((c) => c.name, []));
    const collectionIds = useMemo(() => filteredCollections.map((c) => c.id), [filteredCollections]);

    const handleDeleteCollections = useCallback(async (ids: string[]) => {
        try {
            await Promise.all(ids.map((id) => deleteCollection.mutateAsync(id)));
            toast.success(`Deleted ${ids.length} collection${ids.length !== 1 ? 's' : ''}`);
        }
        catch {
            toast.error('Failed to delete');
        }
    }, [deleteCollection]);

    return (
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
                            onSelect={(e: React.MouseEvent) => {
                                if (!selection.isSelecting) selection.startSelecting();
                                if (e.shiftKey) {
                                    selection.addRange(c.id, collectionIds);
                                }
                                else {
                                    selection.toggle(c.id);
                                }
                            }}
                        />
                    </div>
                ))}
            </div>
        </PageContainer>
    );
}
