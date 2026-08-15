'use client';

import { pluralize } from '@/lib/utils/pluralize';
import { useState, useCallback } from 'react';
import { X, Trash2, FolderPlus, FolderMinus, Download, RotateCcw, EyeOff, Share2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { AddToCollectionModal } from '@/components/collections/AddToCollectionModal';
import { archiveUrl, downloadUrl, originalUrl } from '@/lib/api/media';
import { useDownload } from '@/lib/hooks/useDownload';
import type { useMediaSelection } from '@/lib/hooks/useMediaSelection';

interface SelectionToolbarProps {
    selection: ReturnType<typeof useMediaSelection>;
    /** Called to delete selected items. Must return a promise. */
    onDelete?: (ids: string[]) => void | Promise<void>;
    /** Message shown in the delete confirmation modal */
    deleteConfirmMessage?: string;
    /** Show "Add to collection" button (media mode) */
    showAddToCollection?: boolean;
    /** Show "Share" button for mass sharing selected items */
    showShare?: boolean;
    /** Show "Download" button (media mode) */
    showDownload?: boolean;
    /** Show "Retry" button for reprocessing failed items */
    showRetry?: boolean;
    /** Called to retry selected items. Must return a promise. */
    onRetry?: (ids: string[]) => void | Promise<void>;
    /** Custom URL function for downloads (defaults to originalUrl) */
    downloadUrlFn?: (id: string) => string;
    /**
     * Endpoint that streams the selection as one zip, which is how a multi-file
     * download reaches a phone at all (see DownloadProvider). Defaults to the
     * library's; pass null in a context that has no such endpoint, such as a public
     * share link, and the selection is downloaded file by file instead.
     */
    archiveUrlFn?: (() => string) | null;
    /** Loading state for delete action */
    deleteLoading?: boolean;
    /** Show "Hide" button (eye-off icon) */
    showHide?: boolean;
    /** Called to hide selected items */
    onHide?: (ids: string[]) => void | Promise<void>;
    /** Called to remove selected items from a collection. */
    onRemoveFromCollection?: (ids: string[]) => void | Promise<void>;
    /** Loading state for remove-from-collection action */
    removeFromCollectionLoading?: boolean;
}

export function SelectionToolbar({
    selection,
    onDelete,
    deleteConfirmMessage,
    showAddToCollection,
    showShare,
    showDownload,
    showRetry,
    onRetry,
    downloadUrlFn,
    archiveUrlFn,
    deleteLoading,
    showHide,
    onHide,
    onRemoveFromCollection,
    removeFromCollectionLoading,
}: SelectionToolbarProps) {
    const { triggerDownload } = useDownload();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [removeFromCollectionOpen, setRemoveFromCollectionOpen] = useState(false);
    const [collectionModalOpen, setCollectionModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);

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

    const handleRemoveFromCollection = async () => {
        if (!onRemoveFromCollection) return;
        setIsRemoving(true);
        try {
            await onRemoveFromCollection(Array.from(selection.selectedIds));
            selection.clearSelection();
        }
        finally {
            setIsRemoving(false);
            setRemoveFromCollectionOpen(false);
        }
    };

    const getDownloadUrl = downloadUrlFn ?? downloadUrl;

    const handleShare = useCallback(async () => {
        try {
            const files: File[] = [];
            for (const id of selection.selectedIds) {
                const res = await fetch(originalUrl(id));
                const blob = await res.blob();
                const ext = blob.type.split('/')[1] || 'jpg';
                files.push(new File([blob], `photo-${id}.${ext}`, { type: blob.type }));
            }
            await navigator.share({ files });
        }
        catch {
            // Share cancelled or not supported
        }
    }, [selection.selectedIds]);

    // Undefined means "not overridden" and null means "there isn't one here", so the
    // default cannot be a parameter default.
    const getArchiveUrl = archiveUrlFn === undefined ? archiveUrl : archiveUrlFn;

    // Not async, and nothing awaited before triggerDownload: on a phone the download
    // is handed to the browser inside this tap, and an await would spend the
    // activation that allows it.
    const handleDownload = useCallback(() => {
        triggerDownload(
            Array.from(selection.selectedIds).map((id) => ({
                id,
                url: getDownloadUrl(id),
            })),
            getArchiveUrl ? { archiveUrl: getArchiveUrl() } : {}
        );
    }, [selection.selectedIds, getDownloadUrl, getArchiveUrl, triggerDownload]);

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
                {onRemoveFromCollection && (
                    <IconButton
                        icon={FolderMinus}
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoveFromCollectionOpen(true)}
                        title="Remove from collection"
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
                {showShare && (
                    <IconButton
                        icon={Share2}
                        size="sm"
                        variant="ghost"
                        onClick={handleShare}
                        title="Share selected"
                    />
                )}
                {showHide && onHide && (
                    <IconButton
                        icon={EyeOff}
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                            await onHide(Array.from(selection.selectedIds));
                            selection.clearSelection();
                        }}
                        title="Hide selected"
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

            {onRemoveFromCollection && (
                <ConfirmModal
                    open={removeFromCollectionOpen}
                    onClose={() => setRemoveFromCollectionOpen(false)}
                    onConfirm={handleRemoveFromCollection}
                    message={`Remove ${pluralize(selection.count, 'item')} from this collection? The files will not be deleted.`}
                    loading={removeFromCollectionLoading ?? isRemoving}
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
