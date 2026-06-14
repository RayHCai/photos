'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { batchDeleteMedia, downloadUrl } from '@/lib/api/media';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { IconButton, getIconButtonStyles } from '@/components/ui/IconButton';
import { useDownload } from '@/lib/hooks/useDownload';

interface MediaActionsProps {
    mediaId: string;
    onDelete?: () => void;
}

const downloadStyles = getIconButtonStyles({ size: 'sm', variant: 'overlay' });

export function MediaActions({ mediaId, onDelete }: MediaActionsProps) {
    const queryClient = useQueryClient();
    const { triggerDownload } = useDownload();
    const [confirmOpen, setConfirmOpen] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: () => batchDeleteMedia([mediaId]),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['media'] });
            toast.success('Deleted');
            onDelete?.();
        },
        onError: () => {
            toast.error('Failed to delete');
        },
    });

    return (
        <>
            <div className="flex items-center gap-0.5">
                <button
                    type="button"
                    onClick={() => triggerDownload([{ id: mediaId, url: downloadUrl(mediaId) }])}
                    className={downloadStyles.button}
                    title="Download"
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
                />
            </div>

            <ConfirmModal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => {
                    deleteMutation.mutate();
                    setConfirmOpen(false);
                }}
                message="Are you sure you want to delete this item? This cannot be undone."
                loading={deleteMutation.isPending}
            />
        </>
    );
}
