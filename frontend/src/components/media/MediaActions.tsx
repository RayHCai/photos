'use client';

import { useEffect, useState } from 'react';
import { batchDeleteMedia, downloadUrl } from '@/lib/api/media';
import { Download, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { IconButton, getIconButtonStyles } from '@/components/ui/IconButton';
import { useDownload } from '@/lib/hooks/useDownload';
import { useAppMutation } from '@/lib/hooks/useAppMutation';

interface MediaActionsProps {
    mediaId: string;
    onDelete?: () => void;
    /**
     * Reports whether a modal owned by this component is open, so the lightbox can
     * suspend its own keyboard navigation.
     */
    onConfirmOpenChange?: (open: boolean) => void;
}

const downloadStyles = getIconButtonStyles({ size: 'sm', variant: 'overlay' });

export function MediaActions({ mediaId, onDelete, onConfirmOpenChange }: MediaActionsProps) {
    const { triggerDownload } = useDownload();
    const [confirmOpen, setConfirmOpen] = useState(false);

    /**
     * Close the confirmation if the item underneath changes.
     *
     * This component is rendered by MediaLightbox without a `key`, so React reuses
     * the same instance as the user navigates. The dialog therefore stayed open
     * across a slide change while `mediaId` silently became a different photo: open
     * photo A, tap delete, press the arrow key, confirm — and photo B was deleted.
     * The lightbox now also suspends arrow navigation while this is open (see
     * onConfirmOpenChange), so this is the second of two independent guards.
     */
    useEffect(() => {
        setConfirmOpen(false);
    }, [mediaId]);

    useEffect(() => {
        onConfirmOpenChange?.(confirmOpen);
    }, [confirmOpen, onConfirmOpenChange]);

    const deleteMutation = useAppMutation({
        // Takes the id as a variable rather than closing over it, so the value used
        // is the one passed at confirm time.
        mutationFn: (id: string) => batchDeleteMedia([id]),
        effects: ['media-set'],
        successMessage: 'Deleted',
        errorMessage: 'Failed to delete',
        onSuccess: () => onDelete?.(),
    });

    return (
        <>
            <div className="flex items-center gap-0.5">
                <button
                    type="button"
                    onClick={() => triggerDownload([{ id: mediaId, url: downloadUrl(mediaId) }])}
                    className={downloadStyles.button}
                    title="Download"
                    aria-label="Download"
                >
                    <Download className={downloadStyles.icon} />
                </button>
                <IconButton
                    icon={Trash2}
                    size="sm"
                    variant="overlay"
                    danger
                    onClick={() => setConfirmOpen(true)}
                    title="Delete"
                    aria-label="Delete"
                />
            </div>

            <ConfirmModal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => {
                    deleteMutation.mutate(mediaId);
                    setConfirmOpen(false);
                }}
                message="Are you sure you want to delete this item? This cannot be undone."
                loading={deleteMutation.isPending}
            />
        </>
    );
}
