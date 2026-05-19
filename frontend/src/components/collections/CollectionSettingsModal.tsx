'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUpdateCollection, useDeleteCollection } from '@/lib/hooks/useCollections';
import { CollectionForm } from './CollectionForm';
import { ShareLinkManager } from './ShareLinkManager';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface CollectionSettingsModalProps {
    collectionId: string;
    collectionName: string;
    collectionDescription: string | null;
    open: boolean;
    onClose: () => void;
}

export function CollectionSettingsModal({
    collectionId,
    collectionName,
    collectionDescription,
    open,
    onClose,
}: CollectionSettingsModalProps) {
    const router = useRouter();
    const updateCollection = useUpdateCollection();
    const deleteCollection = useDeleteCollection();
    const [deleteOpen, setDeleteOpen] = useState(false);

    if (!open) return null;

    return (
        <Dialog title="Collection Settings" open={open} onClose={onClose}>
            <div className="space-y-6">
                <CollectionForm
                    initialName={collectionName}
                    initialDescription={collectionDescription || ''}
                    submitLabel="Save"
                    loading={updateCollection.isPending}
                    onSubmit={(data) => {
                        updateCollection.mutate(
                            { id: collectionId, data },
                            {
                                onSuccess: () => {
                                    toast.success('Collection updated');
                                },
                            }
                        );
                    }}
                />

                <hr className="border-stone-200" />

                <ShareLinkManager collectionId={collectionId} />

                <hr className="border-stone-200" />

                <div>
                    <h3 className="text-sm font-medium text-stone-700 mb-2">
                        Danger Zone
                    </h3>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteOpen(true)}
                        loading={deleteCollection.isPending}
                    >
                        <Trash2 className="w-4 h-4" />
                        Delete collection
                    </Button>

                    <ConfirmModal
                        open={deleteOpen}
                        onClose={() => setDeleteOpen(false)}
                        onConfirm={() => {
                            deleteCollection.mutate(collectionId, {
                                onSuccess: () => {
                                    toast.success('Collection deleted');
                                    router.push('/collections');
                                },
                            });
                            setDeleteOpen(false);
                        }}
                        message="Delete this collection? Items will not be deleted."
                        loading={deleteCollection.isPending}
                    />
                </div>
            </div>
        </Dialog>
    );
}
