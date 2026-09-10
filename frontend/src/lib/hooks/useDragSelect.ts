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

// How long a finger must rest on a photo before a drag-select begins.
//
// 350ms was below both platforms' long-press conventions (iOS and Android use ~500ms),
// which made the most ordinary gesture on a phone — flick, then plant a finger to arrest
// the momentum and look at what went past — resolve as a selection paint instead. The
// finger is deliberately still at that moment, so the slop check never cancelled it.
const LONG_PRESS_MS = 500;
// Finger travel (px) during the long-press wait that reclassifies the gesture as
// a scroll and cancels the pending selection. Also raised to the platform touch slop:
// 10px is inside the jitter of a resting thumb.
const MOVE_SLOP = 14;
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
    /**
     * Identifier of the touch that owns the drag.
     *
     * `TouchEvent.touches` is every contact on the screen, not the ones on this element,
     * so "the drag finger lifted" cannot be read off the count — a second finger resting
     * anywhere keeps it above zero. Matching on the identifier ends the drag when *this*
     * finger goes up, whatever else is happening.
     */
    const activeTouchId = useRef<number | null>(null);
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
            // Idempotent: a leaked drag must not be layered under a new one.
            if (isDragging.current) endDrag();
            longPressTimer.current = null;
            isDragging.current = true;
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

        /**
         * The drag does *not* touch `el.style.touchAction`.
         *
         * It used to set it to `none` on start and restore it on end, which was both
         * useless and dangerous. Useless because both engines resolve the effective
         * touch-action by hit-testing when a touch sequence *begins*, and never
         * re-consult it mid-sequence — so a value written from inside a long-press timer
         * could not affect the gesture it was meant to protect (the non-passive
         * `preventDefault` in onTouchMove does that). Dangerous because GalleryGrid sets
         * `touchAction: 'pan-y'` on the same node as a React inline style: React's style
         * diff only writes a property whose value *changed* between renders, and 'pan-y'
         * never changes, so React can never repair an imperative overwrite. Any drag that
         * ended without running this function left `touch-action: none` latched on the
         * gallery's only scroll container for the life of the page — the reported "cannot
         * scroll, but the buttons still work". It was self-worsening too: the next
         * startDrag saved the poisoned 'none' as the value to restore.
         */
        const endDrag = () => {
            if (!isDragging.current) return;
            isDragging.current = false;
            activeTouchId.current = null;
            stopAutoScroll();
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
            activeTouchId.current = t.identifier;
            clearLongPress();
            longPressTimer.current = setTimeout(() => startDrag(id), LONG_PRESS_MS);
        };

        /**
         * A scroll means the finger that is down is scrolling, not pressing.
         *
         * Without this, planting a finger to arrest a momentum fling arms the long press
         * and — because arresting momentum means holding still — nothing cancels it. The
         * gesture the user meant as "stop and look" became "enter selection mode", and
         * every subsequent touchmove was preventDefault'd into a selection paint.
         *
         * Guarded on `!isDragging`, so the hook's own edge auto-scroll cannot cancel the
         * drag it is scrolling for.
         */
        const onScroll = () => {
            if (!isDragging.current) clearLongPress();
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

        /**
         * Bound to the window, in the capture phase, rather than to the container.
         *
         * A touch event is dispatched to the node the touch *started* on. Two ordinary
         * things detach that node mid-gesture: the virtualizer unmounts the row (the edge
         * auto-scroll below writes `scrollTop` every frame, so this is routine), and the
         * window slides a page out from under the finger. Once the original target is
         * gone, neither `touchend` nor `touchcancel` reaches the container, so the drag
         * was never ended — `isDragging` stayed true, every later touchmove was
         * preventDefault'd, and the gallery could not be scrolled again for the life of
         * the page. A lift over a sibling that is not inside the scroller at all — the
         * timeline scrollbar overlay, the header, the selection toolbar — did the same.
         *
         * A window listener sees the lift wherever it lands, and `endDrag` early-returns
         * unless this hook actually started a drag, so a touch elsewhere in the app
         * cannot fabricate one.
         */
        const onTouchEnd = (e: TouchEvent) => {
            clearLongPress();
            if (!isDragging.current) return;
            const stillDown = Array.from(e.touches).some(
                (t) => t.identifier === activeTouchId.current
            );
            if (!stillDown || e.touches.length === 0) endDrag();
        };

        // Separate from onTouchEnd on purpose: a cancel is unconditional and must not
        // inherit any surviving-touch test.
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
        el.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
        window.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });
        el.addEventListener('click', onClickCapture, true);
        el.addEventListener('contextmenu', onContextMenu);

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('scroll', onScroll);
            window.removeEventListener('touchend', onTouchEnd, { capture: true });
            window.removeEventListener('touchcancel', onTouchCancel, { capture: true });
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
            activeTouchId.current = null;
            if (isDragging.current) {
                isDragging.current = false;
                controllerRef.current?.end();
            }
        };
    }, [containerRef, enabled]);
}
