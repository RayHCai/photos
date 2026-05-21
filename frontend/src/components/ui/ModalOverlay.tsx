'use client';

import { useRef, type ReactNode } from 'react';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';

interface ModalOverlayProps {
    onClose: () => void;
    enabled?: boolean;
    className?: string;
    children: ReactNode;
}

export function ModalOverlay({ onClose, enabled = true, className, children }: ModalOverlayProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEscapeKey(onClose, enabled);

    return (
        <div
            ref={overlayRef}
            className={className ?? 'fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40'}
            onClick={(e) => {
                if (e.target === overlayRef.current) onClose();
            }}
        >
            {children}
        </div>
    );
}
