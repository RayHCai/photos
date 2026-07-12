'use client';

import { useEffect, useRef } from 'react';

/**
 * Imperative bridge to the selection state, supplied by the gallery. Kept minimal
 * (three calls keyed by media id) so this hook stays agnostic of how selection is
 * stored. The id under the finger is resolved here via hit-testing.
 */
export interface DragSelectController {
    /** Start a paint anchored at this photo (also enters selection mode). */
    begin: (anchorId: string) => void;
    /** Extend the paint to the photo currently under the finger. */
    update: (currentId: string) => void;
    /** Finish the paint. */
    end: () => void;
}

// How long a finger must rest on a photo before a drag-select begins. Short
// enough to feel responsive, long enough that a flick reads as a scroll.
const LONG_PRESS_MS = 350;
// Finger travel (px) during the long-press wait that reclassifies the gesture as
// a scroll and cancels the pending selection.
const MOVE_SLOP = 10;
// Distance (px) from the top/bottom edge of the scroll viewport within which a
// held drag triggers auto-scroll.
const EDGE_ZONE = 90;
// Peak auto-scroll speed in px per animation frame (~60fps => ~960px/s).
const MAX_SCROLL_SPEED = 16;

function mediaIdAtPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>('[data-media-id]')?.dataset.mediaId ?? null;
}

/**
 * Mobile drag-to-select for the gallery grid, mimicking Photos apps:
 * press-and-hold a photo to enter selection mode, then keep the finger down and
 * drag to paint a range of photos. Dragging toward the top/bottom edge auto-scrolls
 * while continuing to paint newly revealed rows. A quick drag (before the long
 * press fires) scrolls normally; a two-finger touch defers to pinch-to-zoom.
 *
 * Listeners are registered once per enable and read live values through refs, so
 * a changing `controller`/re-render never re-registers mid-gesture.
 */
export function useDragSelect(
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean,
    controller: DragSelectController | undefined,
) {
    const controllerRef = useRef(controller);
    controllerRef.current = controller;

    // Gesture state (refs: mutated across touch + rAF frames between renders).
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const startY = useRef(0);
    const lastX = useRef(0);
    const lastY = useRef(0);
    const scrollVelocity = useRef(0);
    const rafId = useRef(0);
    // Original inline touch-action, restored when a drag ends.
    const prevTouchAction = useRef<string>('');
    // After a real gesture, swallow the trailing synthetic click so it can't
    // toggle the item under the finger (which would undo a just-made selection).
    const suppressClick = useRef(false);
    const suppressClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        const clearLongPress = () => {
            if (longPressTimer.current !== null) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        };

        const stopAutoScroll = () => {
            scrollVelocity.current = 0;
            if (rafId.current) {
                cancelAnimationFrame(rafId.current);
                rafId.current = 0;
            }
        };

        // Runs off rAF while the finger is held in an edge zone. Scrolls the
        // viewport, then re-hit-tests the (stationary) finger point so freshly
        // revealed photos get painted.
        const autoScrollTick = () => {
            if (!isDragging.current || scrollVelocity.current === 0) {
                rafId.current = 0;
                return;
            }
            const before = el.scrollTop;
            el.scrollTop = before + scrollVelocity.current;
            if (el.scrollTop === before) {
                // Hit a scroll boundary — nothing new to reveal, stop burning frames.
                rafId.current = 0;
                scrollVelocity.current = 0;
                return;
            }
            const id = mediaIdAtPoint(lastX.current, lastY.current);
            if (id) controllerRef.current?.update(id);
            rafId.current = requestAnimationFrame(autoScrollTick);
        };

        // Recompute edge auto-scroll velocity from the finger's viewport position.
        const evaluateAutoScroll = () => {
            const rect = el.getBoundingClientRect();
            const y = lastY.current;
            let velocity = 0;
            if (y > rect.bottom - EDGE_ZONE) {
                const depth = Math.min(1, (y - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE);
                velocity = depth * MAX_SCROLL_SPEED;
            }
            else if (y < rect.top + EDGE_ZONE) {
                const depth = Math.min(1, ((rect.top + EDGE_ZONE) - y) / EDGE_ZONE);
                velocity = -depth * MAX_SCROLL_SPEED;
            }
            scrollVelocity.current = velocity;
            if (velocity !== 0 && rafId.current === 0) {
                rafId.current = requestAnimationFrame(autoScrollTick);
            }
        };

        const startDrag = (anchorId: string) => {
            longPressTimer.current = null;
            isDragging.current = true;
            // Take over touch handling so the browser doesn't pan/zoom while we
            // paint and drive our own auto-scroll.
            prevTouchAction.current = el.style.touchAction;
            el.style.touchAction = 'none';
            navigator.vibrate?.(10);
            controllerRef.current?.begin(anchorId);
        };

        // Arm suppression of the one click the browser emits after this gesture.
        // Auto-disarms shortly after in case no click actually follows (e.g. a
        // drag that moved far enough that the browser fires no click at all).
        const armClickSuppression = () => {
            suppressClick.current = true;
            if (suppressClickTimer.current) clearTimeout(suppressClickTimer.current);
            suppressClickTimer.current = setTimeout(() => {
                suppressClick.current = false;
                suppressClickTimer.current = null;
            }, 500);
        };

        const endDrag = () => {
            if (!isDragging.current) return;
            isDragging.current = false;
            stopAutoScroll();
            el.style.touchAction = prevTouchAction.current;
            armClickSuppression();
            controllerRef.current?.end();
        };

        const onTouchStart = (e: TouchEvent) => {
            if (!controllerRef.current) return;
            // Second finger: abandon any drag/pending press and let pinch-to-zoom own it.
            if (e.touches.length !== 1) {
                clearLongPress();
                endDrag();
                return;
            }
            const t = e.touches[0];
            const id = mediaIdAtPoint(t.clientX, t.clientY);
            if (!id) return; // not on a photo (e.g. date header) — leave scroll alone
            startX.current = t.clientX;
            startY.current = t.clientY;
            lastX.current = t.clientX;
            lastY.current = t.clientY;
            clearLongPress();
            longPressTimer.current = setTimeout(() => startDrag(id), LONG_PRESS_MS);
        };

        const onTouchMove = (e: TouchEvent) => {
            if (isDragging.current) {
                if (e.touches.length !== 1) {
                    endDrag();
                    return;
                }
                // Suppress native scroll — we paint and auto-scroll ourselves.
                if (e.cancelable) e.preventDefault();
                const t = e.touches[0];
                lastX.current = t.clientX;
                lastY.current = t.clientY;
                const id = mediaIdAtPoint(t.clientX, t.clientY);
                if (id) controllerRef.current?.update(id);
                evaluateAutoScroll();
                return;
            }
            // Still waiting on the long press: movement past the slop is a scroll.
            if (longPressTimer.current !== null && e.touches.length === 1) {
                const t = e.touches[0];
                const dx = t.clientX - startX.current;
                const dy = t.clientY - startY.current;
                if (dx * dx + dy * dy > MOVE_SLOP * MOVE_SLOP) {
                    clearLongPress();
                }
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            clearLongPress();
            if (isDragging.current && e.touches.length === 0) {
                endDrag();
            }
        };

        const onTouchCancel = () => {
            clearLongPress();
            endDrag();
        };

        // Capture phase: run before React's delegated handler so stopPropagation
        // also prevents the item's onClick from firing.
        const onClickCapture = (e: MouseEvent) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            if (suppressClickTimer.current) {
                clearTimeout(suppressClickTimer.current);
                suppressClickTimer.current = null;
            }
            e.preventDefault();
            e.stopPropagation();
        };

        // On touch devices a long-press raises `contextmenu`; we own the long
        // press for drag-select, so swallow it — this both blocks the native menu
        // and stops the item's onContextMenu handler from double-toggling the
        // selection. Only registered while enabled (mobile), so desktop
        // right-click-to-select is untouched.
        const onContextMenu = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchCancel, { passive: true });
        el.addEventListener('click', onClickCapture, true);
        el.addEventListener('contextmenu', onContextMenu);

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchCancel);
            el.removeEventListener('click', onClickCapture, true);
            el.removeEventListener('contextmenu', onContextMenu);
            clearLongPress();
            if (suppressClickTimer.current) {
                clearTimeout(suppressClickTimer.current);
                suppressClickTimer.current = null;
            }
            suppressClick.current = false;
            if (rafId.current) cancelAnimationFrame(rafId.current);
            rafId.current = 0;
            scrollVelocity.current = 0;
            if (isDragging.current) {
                isDragging.current = false;
                el.style.touchAction = prevTouchAction.current;
                controllerRef.current?.end();
            }
        };
    }, [containerRef, enabled]);
}
