'use client';

import { useState, useMemo, useRef } from 'react';
import { X, Edit2, Merge, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { usePersonMedia, useDeletePerson } from '@/lib/hooks/usePersons';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { thumbnailUrl } from '@/lib/api/media';
import { PersonRenameDialog } from './PersonRenameDialog';
import { PersonMergeDialog } from './PersonMergeDialog';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Spinner } from '@/components/ui/Spinner';
import { MediaLightbox } from '@/components/media/MediaLightbox';
import { toast } from 'sonner';
import type { Person } from '@/lib/types/persons';

interface PersonDetailModalProps {
    person: Person;
    onClose: () => void;
}

export function PersonDetailModal({ person, onClose }: PersonDetailModalProps) {
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
        usePersonMedia(person.id);
    const deletePerson = useDeletePerson();

    const [renameOpen, setRenameOpen] = useState(false);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [lightboxId, setLightboxId] = useState<string | null>(null);

    const overlayRef = useRef<HTMLDivElement>(null);

    const allItems = useMemo(
        () => data?.pages.flatMap((p) => p.items) || [],
        [data]
    );

    const sentinelRef = useInfiniteScroll(
        () => fetchNextPage(),
        !!hasNextPage && !isFetchingNextPage
    );

    useEscapeKey(onClose, !renameOpen && !mergeOpen && !deleteOpen && !lightboxId);

    const handleDelete = () => {
        deletePerson.mutate(person.id, {
            onSuccess: () => {
                toast.success('Person deleted');
                onClose();
            },
        });
        setDeleteOpen(false);
    };

    return (
        <>
            <div
                ref={overlayRef}
                className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40"
                onClick={(e) => {
                    if (e.target === overlayRef.current) onClose();
                }}
            >
                <div className="bg-stone-50 rounded shadow-lg w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
                        <div>
                            <h2 className="text-lg font-serif text-stone-900">
                                {person.name || 'Unknown'}
                            </h2>
                            <p className="text-xs text-stone-500">
                                {person._count.faces} photo{person._count.faces !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-1">
                            <IconButton
                                icon={Edit2}
                                onClick={() => setRenameOpen(true)}
                                title="Rename"
                            />
                            <IconButton
                                icon={Merge}
                                onClick={() => setMergeOpen(true)}
                                title="Merge"
                            />
                            <IconButton
                                icon={Trash2}
                                danger
                                onClick={() => setDeleteOpen(true)}
                                title="Delete"
                            />
                            <IconButton
                                icon={X}
                                size="xs"
                                iconClassName="w-5 h-5"
                                onClick={onClose}
                                className="ml-2"
                            />
                        </div>
                    </div>

                    {/* Media grid */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        {isLoading ? (
                            <div className="flex justify-center py-12">
                                <Spinner className="w-6 h-6" />
                            </div>
                        ) : allItems.length === 0 ? (
                            <p className="text-center text-sm text-stone-400 py-12">
                                No photos
                            </p>
                        ) : (
                            <>
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5">
                                    {allItems.map((item) => (
                                        <button
                                            key={item.id}
                                            className="aspect-square rounded overflow-hidden bg-stone-100 hover:ring-1 hover:ring-stone-300 transition-all"
                                            onClick={() => setLightboxId(item.id)}
                                        >
                                            {item.thumbnailKey ? (
                                                <img
                                                    src={thumbnailUrl(item.id)}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-stone-200" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                                <div ref={sentinelRef} className="h-2" />
                                {isFetchingNextPage && (
                                    <div className="flex justify-center py-4">
                                        <Spinner className="w-5 h-5" />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            <PersonRenameDialog
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                personId={person.id}
                currentName={person.name}
            />

            <PersonMergeDialog
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                sourceId={person.id}
                sourceName={person.name}
            />

            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDelete}
                message="Delete this person? Their faces will be unassigned."
                loading={deletePerson.isPending}
            />

            {lightboxId && (
                <MediaLightbox
                    mediaId={lightboxId}
                    onClose={() => setLightboxId(null)}
                    onPrev={
                        allItems.findIndex((i) => i.id === lightboxId) > 0
                            ? () => {
                                const idx = allItems.findIndex((i) => i.id === lightboxId);
                                setLightboxId(allItems[idx - 1].id);
                            }
                            : undefined
                    }
                    onNext={
                        allItems.findIndex((i) => i.id === lightboxId) < allItems.length - 1
                            ? () => {
                                const idx = allItems.findIndex((i) => i.id === lightboxId);
                                setLightboxId(allItems[idx + 1].id);
                            }
                            : undefined
                    }
                />
            )}
        </>
    );
}
