'use client';

import { useState, useMemo } from 'react';
import { X, Edit2, Merge, Trash2, Share2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Dialog } from '@/components/ui/Dialog';
import { usePersonMedia, useDeletePerson } from '@/lib/hooks/usePersons';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import { useLightboxNavigation } from '@/lib/hooks/useLightboxNavigation';
import { pluralize } from '@/lib/utils/pluralize';
import { ThumbnailGrid } from '@/components/ui/ThumbnailGrid';
import { PersonRenameDialog } from './PersonRenameDialog';
import { PersonMergeDialog } from './PersonMergeDialog';
import { PersonShareDialog } from './PersonShareDialog';
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
    const [shareOpen, setShareOpen] = useState(false);
    const [lightboxId, setLightboxId] = useState<string | null>(null);

    const allItems = useMemo(() => {
        const seen = new Set<string>();
        return (data?.pages.flatMap((p) => p.items) || []).filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
    }, [data]);

    const sentinelRef = useInfiniteScroll(
        () => fetchNextPage(),
        !!hasNextPage && !isFetchingNextPage
    );

    const { onPrev, onNext, prevMediaId, nextMediaId } = useLightboxNavigation(allItems, lightboxId, setLightboxId);

    const handleDelete = () => {
        deletePerson.mutate(person.id, {
            onSuccess: () => {
                toast.success('Person deleted');
                onClose();
            },
        });
        setDeleteOpen(false);
    };

    const customHeader = (
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
            <div>
                <h2 className="text-lg font-serif text-stone-900">
                    {person.name || 'Unknown'}
                </h2>
                <p className="text-xs text-stone-500">
                    {pluralize(person._count.faces, 'photo')}
                </p>
            </div>
            <div className="flex items-center gap-1">
                <IconButton
                    icon={Edit2}
                    onClick={() => setRenameOpen(true)}
                    title="Rename"
                />
                <IconButton
                    icon={Share2}
                    onClick={() => {
                        if (!person.name) {
                            toast.error('Name this person before sharing');
                            setRenameOpen(true);
                            return;
                        }
                        setShareOpen(true);
                    }}
                    title="Share"
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
    );

    return (
        <>
            <Dialog
                open
                onClose={onClose}
                header={customHeader}
                maxWidth="max-w-3xl"
                scrollable
                overlayEnabled={!renameOpen && !mergeOpen && !deleteOpen && !shareOpen && !lightboxId}
            >
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
                        <ThumbnailGrid
                            items={allItems}
                            onItemClick={(id) => setLightboxId(id)}
                        />
                        <div ref={sentinelRef} className="h-2" />
                        {isFetchingNextPage && (
                            <div className="flex justify-center py-4">
                                <Spinner className="w-5 h-5" />
                            </div>
                        )}
                    </>
                )}
            </Dialog>

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

            {person.name && (
                <PersonShareDialog
                    open={shareOpen}
                    onClose={() => setShareOpen(false)}
                    personId={person.id}
                    personName={person.name}
                />
            )}

            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDelete}
                message="Delete this person? Their faces will be permanently removed."
                loading={deletePerson.isPending}
            />

            {lightboxId && (
                <MediaLightbox
                    mediaId={lightboxId}
                    onClose={() => setLightboxId(null)}
                    onPrev={onPrev}
                    onNext={onNext}
                    prevMediaId={prevMediaId}
                    nextMediaId={nextMediaId}
                />
            )}
        </>
    );
}
