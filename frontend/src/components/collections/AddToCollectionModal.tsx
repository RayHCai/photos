'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, FolderOpen, Check, Loader2, ExternalLink, Search } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { IconButton } from '@/components/ui/IconButton';
import { ModalOverlay } from '@/components/ui/ModalOverlay';
import { useCollections, useCreateCollection, useAddCollectionItems, useRemoveCollectionItems, useCollectionMembership } from '@/lib/hooks/useCollections';
import { pluralize } from '@/lib/utils/pluralize';
import { toast } from 'sonner';

interface AddToCollectionModalProps {
    open: boolean;
    onClose: () => void;
    mediaItemIds: string[];
}

export function AddToCollectionModal({ open, onClose, mediaItemIds }: AddToCollectionModalProps) {
    const router = useRouter();
    const { data: collections = [] } = useCollections();
    const { data: memberOf = new Set<string>() } = useCollectionMembership(mediaItemIds);
    const createCollection = useCreateCollection();
    const addItems = useAddCollectionItems();
    const removeItems = useRemoveCollectionItems();

    const [creatingNew, setCreatingNew] = useState(false);
    const [newName, setNewName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [addedTo, setAddedTo] = useState<string | null>(null);
    const [removedFrom, setRemovedFrom] = useState<string | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const filteredCollections = useMemo(() => {
        if (!searchQuery.trim()) return collections;
        const q = searchQuery.toLowerCase().trim();
        return collections.filter((c) => c.name.toLowerCase().includes(q));
    }, [collections, searchQuery]);

    useEffect(() => {
        if (open) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
        }
    }, [open]);

    useEffect(() => {
        if (creatingNew) {
            nameInputRef.current?.focus();
        }
    }, [creatingNew]);

    useEffect(() => {
        if (!open) {
            setCreatingNew(false);
            setNewName('');
            setSearchQuery('');
            setAddedTo(null);
            setRemovedFrom(null);
        }
    }, [open]);

    if (!open) return null;

    const isBusy = addItems.isPending || removeItems.isPending || createCollection.isPending;

    const handleToggleCollection = async (collectionId: string, collectionName: string) => {
        if (isBusy) return;
        const isInCollection = memberOf.has(collectionId);
        try {
            if (isInCollection) {
                await removeItems.mutateAsync({ collectionId, mediaItemIds });
                setRemovedFrom(collectionId);
                toast.success(`Removed from ${collectionName}`);
                setTimeout(() => onClose(), 600);
            }
            else {
                await addItems.mutateAsync({ collectionId, mediaItemIds });
                setAddedTo(collectionId);
                toast.success(`Added to ${collectionName}`);
                setTimeout(() => onClose(), 600);
            }
        }
        catch {
            toast.error(isInCollection ? 'Failed to remove items' : 'Failed to add items');
        }
    };

    const handleCreateAndAdd = async () => {
        if (!newName.trim() || isBusy) return;
        try {
            const collection = await createCollection.mutateAsync({ name: newName.trim() });
            await addItems.mutateAsync({ collectionId: collection.id, mediaItemIds });
            toast.success(`Created "${newName.trim()}" with ${pluralize(mediaItemIds.length, 'item')}`, {
                action: {
                    label: <ExternalLink className="w-3.5 h-3.5" />,
                    onClick: () => router.push(`/collections/${collection.id}`),
                },
            });
            onClose();
        }
        catch {
            toast.error('Failed to create collection');
        }
    };

    return (
        <ModalOverlay onClose={onClose}>
            <div
                className="bg-white rounded-lg shadow-xl w-full max-w-xs mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <h3 className="text-sm font-serif text-stone-900">
                        Add to collection
                    </h3>
                    <IconButton
                        icon={X}
                        size="xs"
                        onClick={onClose}
                        className="-mr-0.5"
                    />
                </div>

                {/* Search */}
                {collections.length > 0 && (
                    <div className="px-3 pb-1">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search collections..."
                                className="w-full h-7 pl-7 pr-2 bg-stone-100 rounded text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:ring-1 focus:ring-stone-300 transition-all"
                            />
                        </div>
                    </div>
                )}

                {/* New collection row */}
                <div className="px-2">
                    {!creatingNew ? (
                        <button
                            onClick={() => setCreatingNew(true)}
                            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-stone-50 text-stone-600 hover:text-stone-900 transition-colors"
                        >
                            <div className="w-7 h-7 rounded bg-stone-900 flex items-center justify-center flex-shrink-0">
                                <Plus className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="text-xs font-medium">New collection</span>
                        </button>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2 py-1.5">
                            <input
                                ref={nameInputRef}
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateAndAdd();
                                    if (e.key === 'Escape') {
                                        setCreatingNew(false);
                                        setNewName('');
                                    }
                                }}
                                placeholder="Collection name"
                                className="flex-1 min-w-0 h-7 px-2 bg-stone-100 rounded text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:ring-1 focus:ring-stone-300 transition-all"
                            />
                            <button
                                onClick={handleCreateAndAdd}
                                disabled={!newName.trim() || isBusy}
                                className="h-7 px-2.5 bg-stone-900 text-white text-xs rounded hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                            >
                                {createCollection.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    'Create'
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Divider */}
                {collections.length > 0 && (
                    <div className="mx-4 my-1 border-t border-stone-100" />
                )}

                {/* Existing collections */}
                {collections.length > 0 && (
                    <div className="px-2 pb-3 max-h-52 overflow-y-auto">
                        {filteredCollections.length === 0 && searchQuery.trim() && (
                            <p className="text-xs text-stone-400 text-center py-3">No collections found</p>
                        )}
                        {filteredCollections.map((c) => {
                            const isInCollection = memberOf.has(c.id);
                            const justAdded = addedTo === c.id;
                            const justRemoved = removedFrom === c.id;
                            const isPending =
                                (addItems.isPending && addItems.variables?.collectionId === c.id) ||
                                (removeItems.isPending && removeItems.variables?.collectionId === c.id);

                            return (
                                <button
                                    key={c.id}
                                    onClick={() => handleToggleCollection(c.id, c.name)}
                                    disabled={isBusy}
                                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-stone-50 transition-colors disabled:opacity-50 group"
                                >
                                    <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                                        isInCollection && !justRemoved
                                            ? 'bg-emerald-100 group-hover:bg-emerald-200'
                                            : 'bg-stone-100 group-hover:bg-stone-200'
                                    }`}>
                                        {justAdded || (isInCollection && !justRemoved) ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        ) : (
                                            <FolderOpen className="w-3.5 h-3.5 text-stone-400" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0 text-left">
                                        <p className="text-xs text-stone-900 truncate">{c.name}</p>
                                        <p className="text-[11px] leading-tight text-stone-400">
                                            {pluralize(c._count.items, 'item')}
                                        </p>
                                    </div>
                                    {isPending && (
                                        <Spinner className="w-3 h-3 flex-shrink-0" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Bottom padding */}
                {collections.length === 0 && <div className="pb-2" />}
            </div>
        </ModalOverlay>
    );
}
