'use client';

import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    message: string;
    confirmLabel?: string;
    loading?: boolean;
}

export function ConfirmModal({
    open,
    onClose,
    onConfirm,
    message,
    confirmLabel = 'Delete',
    loading = false,
}: ConfirmModalProps) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="max-w-sm">
            <p className="text-sm text-stone-600 mb-5">{message}</p>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button variant="danger" size="sm" onClick={onConfirm} loading={loading}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}
