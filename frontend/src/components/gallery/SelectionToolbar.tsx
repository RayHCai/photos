'use client';

import { useState, useCallback } from 'react';
import { X, Trash2, FolderPlus, Download, RotateCcw } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { AddToCollectionModal } from '@/components/collections/AddToCollectionModal';
import { originalUrl } from '@/lib/api/media';
import type { useMediaSelection } from '@/lib/hooks/useMediaSelection';

interface SelectionToolbarProps {
    selection: ReturnType<typeof useMediaSelection>;
    /** Called to delete selected items. Must return a promise. */
    onDelete?: (ids: string[]) => Promise<void>;
    /** Message shown in the delete confirmation modal */
    deleteConfirmMessage?: string;
    /** Show "Add to collection" button (media mode) */
    showAddToCollection?: boolean;
    /** Show "Download" button (media mode) */
    showDownload?: boolean;
    /** Show "Retry" button for reprocessing failed items */
    showRetry?: boolean;
    /** Called to retry selected items. Must return a promise. */
    onRetry?: (ids: string[]) => Promise<void>;
    /** Custom URL function for downloads (defaults to originalUrl) */
    downloadUrlFn?: (id: string) => string;
    /** Loading state for delete action */
    deleteLoading?: boolean;
}

export function SelectionToolbar({
    selection,
    onDelete,
    deleteConfirmMessage,
    showAddToCollection,
    showDownload,
    showRetry,
    onRetry,
    downloadUrlFn,
    deleteLoading,
}: SelectionToolbarProps) {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [collectionModalOpen, setCollectionModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!onDelete) return;
        setIsDeleting(true);
        try {
            await onDelete(Array.from(selection.selectedIds));
            selection.clearSelection();
        }
        finally {
            setIsDeleting(false);
            setDeleteOpen(false);
        }
    };

    const getDownloadUrl = downloadUrlFn ?? originalUrl;

    const handleDownload = useCallback(() => {
        for (const id of selection.selectedIds) {
            const a = document.createElement('a');
            a.href = getDownloadUrl(id);
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }, [selection.selectedIds, getDownloadUrl]);

    if (!selection.isSelecting) return null;

    return (
        <>
            <div className="absolute right-[30px] top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 h-9 bg-stone-100 rounded-lg px-2">
                <span className="text-xs font-medium text-stone-500 tabular-nums mr-0.5">
                    {selection.count} selected
                </span>
                {onDelete && (
                    <IconButton
                        icon={Trash2}
                        size="sm"
                        variant="ghost"
                        danger
                        onClick={() => setDeleteOpen(true)}
                        title="Delete selected"
                    />
                )}
                {showAddToCollection && (
                    <IconButton
                        icon={FolderPlus}
                        size="sm"
                        variant="ghost"
                        onClick={() => setCollectionModalOpen(true)}
                        title="Add to collection"
                    />
                )}
                {showDownload && (
                    <IconButton
                        icon={Download}
                        size="sm"
                        variant="ghost"
                        onClick={handleDownload}
                        title="Download selected"
                    />
                )}
                {showRetry && onRetry && (
                    <IconButton
                        icon={RotateCcw}
                        size="sm"
                        variant="ghost"
                        onClick={() => onRetry(Array.from(selection.selectedIds))}
                        title="Retry processing"
                    />
                )}
                <IconButton
                    icon={X}
                    size="sm"
                    variant="ghost"
                    onClick={selection.clearSelection}
                    title="Clear selection"
                />
            </div>

            {onDelete && (
                <ConfirmModal
                    open={deleteOpen}
                    onClose={() => setDeleteOpen(false)}
                    onConfirm={handleDelete}
                    message={deleteConfirmMessage ?? `Delete ${selection.count} selected items? This cannot be undone.`}
                    loading={deleteLoading ?? isDeleting}
                />
            )}

            {showAddToCollection && (
                <AddToCollectionModal
                    open={collectionModalOpen}
                    onClose={() => {
                        setCollectionModalOpen(false);
                        selection.clearSelection();
                    }}
                    mediaItemIds={Array.from(selection.selectedIds)}
                />
            )}
        </>
    );
}
