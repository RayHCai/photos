'use client';

import { type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { DialogFooter } from './DialogFooter';
import type { ButtonProps } from './Button';

interface FormDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    onSubmit: (e: React.FormEvent) => void;
    loading?: boolean;
    disabled?: boolean;
    submitLabel?: string;
    submitVariant?: ButtonProps['variant'];
    children: ReactNode;
}

export function FormDialog({
    open,
    onClose,
    title,
    onSubmit,
    loading,
    disabled,
    submitLabel,
    submitVariant,
    children,
}: FormDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title={title}>
            <form onSubmit={onSubmit} className="space-y-4">
                {children}
                <DialogFooter
                    onCancel={onClose}
                    submitLabel={submitLabel}
                    submitVariant={submitVariant}
                    loading={loading}
                    disabled={disabled}
                />
            </form>
        </Dialog>
    );
}
