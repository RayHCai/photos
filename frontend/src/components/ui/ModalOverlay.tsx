'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';

interface ModalOverlayProps {
    onClose: () => void;
    enabled?: boolean;
    className?: string;
    /** Accessible name for the dialog. */
    label?: string;
    children: ReactNode;
}

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The shared modal shell: backdrop dismissal, Escape, scroll lock and a focus trap.
 *
 * It previously did only the first two. Every dialog built on it (Dialog, FormDialog,
 * ConfirmModal, the person and collection modals) therefore let the page scroll behind
 * it — which on mobile also collapsed the address bar mid-interaction — and let Tab walk
 * straight out of the dialog into the page underneath, with no `aria-modal` to tell a
 * screen reader the rest of the document was inert. MediaLightbox hand-rolled its own
 * equivalent, which is how the two drifted apart.
 */
export function ModalOverlay({
    onClose,
    enabled = true,
    className,
    label,
    children,
}: ModalOverlayProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEscapeKey(onClose, enabled);

    /** Scroll lock, restoring whatever was there rather than assuming ''. */
    useEffect(() => {
        if (!enabled) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [enabled]);

    /**
     * Focus trap. Moves focus into the dialog on open, cycles Tab within it, and
     * restores focus to whatever opened it on close — otherwise a keyboard user is
     * dumped back at the top of the document.
     */
    useEffect(() => {
        if (!enabled) return;

        const previouslyFocused = document.activeElement as HTMLElement | null;
        const overlay = overlayRef.current;
        if (!overlay) return;

        const focusables = () =>
            Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                (el) => el.offsetParent !== null || el === document.activeElement
            );

        // Prefer the first control; fall back to the container so focus is at least
        // inside the dialog.
        const initial = focusables()[0];
        if (initial) initial.focus();
        else overlay.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;

            const items = focusables();
            if (items.length === 0) {
                e.preventDefault();
                return;
            }

            const first = items[0]!;
            const last = items[items.length - 1]!;
            const active = document.activeElement;

            if (e.shiftKey && (active === first || !overlay.contains(active))) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            previouslyFocused?.focus?.();
        };
    }, [enabled]);

    return (
        <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            {...(label ? { 'aria-label': label } : {})}
            tabIndex={-1}
            className={
                className ??
                'fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40'
            }
            onClick={(e) => {
                if (e.target === overlayRef.current) onClose();
            }}
        >
            {children}
        </div>
    );
}
