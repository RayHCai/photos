'use client';

import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ModalOverlay } from './ModalOverlay';

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    /** Custom header content (replaces the default title + close button) */
    header?: ReactNode;
    children: ReactNode;
    /** Footer content rendered below the body with a top border */
    footer?: ReactNode;
    /** Max width class (defaults to "max-w-md") */
    maxWidth?: string;
    /** Whether the body should scroll with a max height */
    scrollable?: boolean;
    /** Additional class name for the panel */
    className?: string;
    /** Whether the ModalOverlay escape key is enabled */
    overlayEnabled?: boolean;
}

export function Dialog({
    open,
    onClose,
    title,
    header,
    children,
    footer,
    maxWidth = 'max-w-md',
    scrollable = false,
    className = '',
    overlayEnabled,
}: DialogProps) {
    if (!open) return null;

    return (
        <ModalOverlay onClose={onClose} enabled={overlayEnabled}>
            <div className={`bg-stone-50 rounded shadow-lg w-full ${maxWidth} mx-4 overflow-hidden ${scrollable ? 'max-h-[85vh] flex flex-col' : ''} ${className}`}>
                {header ?? (title && (
                    <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
                        <h2 className="text-lg font-serif text-stone-900">
                            {title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                ))}
                <div className={scrollable ? 'flex-1 min-h-0 overflow-y-auto px-6 py-4' : 'px-6 py-4'}>
                    {children}
                </div>
                {footer && (
                    <div className="px-6 py-4 border-t border-stone-200">
                        {footer}
                    </div>
                )}
            </div>
        </ModalOverlay>
    );
}
