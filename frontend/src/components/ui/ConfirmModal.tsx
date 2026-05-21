'use client';

import { Button } from './Button';
import { ModalOverlay } from './ModalOverlay';

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
    if (!open) return null;

    return (
        <ModalOverlay onClose={onClose}>
            <div className="bg-stone-50 rounded shadow-lg w-full max-w-sm mx-4 px-6 py-5">
                <p className="text-sm text-stone-600 mb-5">{message}</p>
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="danger" size="sm" onClick={onConfirm} loading={loading}>
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </ModalOverlay>
    );
}
