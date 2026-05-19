'use client';

import { useEffect } from 'react';
import { Button } from './Button';

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
    useEffect(() => {
        if (!open) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
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
        </div>
    );
}
