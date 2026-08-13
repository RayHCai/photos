import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;
const DOUBLE_TAP_MS = 300;

function getTouchDistance(t1: Touch, t2: Touch): number {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(t1: Touch, t2: Touch): { x: number; y: number } {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    };
}

/**
 * Pinch-to-zoom, double-tap-to-zoom, and pan for lightbox images.
 * Attaches native touch listeners to the container ref for maximum control.
 */
export function useImageZoom(
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean
) {
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });

    // Gesture tracking refs (no re-renders during gesture)
    const scaleRef = useRef(1);
    const translateRef = useRef({ x: 0, y: 0 });
    const pinchBaseDistance = useRef(0);
    const pinchBaseScale = useRef(1);
    const pinchBaseTranslate = useRef({ x: 0, y: 0 });
    const pinchBaseCenter = useRef({ x: 0, y: 0 });
    const pinchFocalPoint = useRef({ x: 0, y: 0 }); // focal point in untransformed element coords
    const isPinching = useRef(false);
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const panBaseTranslate = useRef({ x: 0, y: 0 });
    const lastTapTime = useRef(0);
    const lastTapX = useRef(0);
    const lastTapY = useRef(0);
    const rafId = useRef(0);

    const isZoomed = scale > 1.05;

    function applyTransform(s: number, tx: number, ty: number) {
        const el = containerRef.current;
        if (!el) return;
        el.style.transform = `scale(${s}) translate(${tx}px, ${ty}px)`;
    }

    function clampTranslate(s: number, tx: number, ty: number): { x: number; y: number } {
        if (s <= 1) return { x: 0, y: 0 };
        const el = containerRef.current;
        if (!el) return { x: tx, y: ty };
        // How much the content extends beyond the container in each direction
        const maxTx = (el.offsetWidth * (s - 1)) / (2 * s);
        const maxTy = (el.offsetHeight * (s - 1)) / (2 * s);
        return {
            x: Math.max(-maxTx, Math.min(maxTx, tx)),
            y: Math.max(-maxTy, Math.min(maxTy, ty)),
        };
    }

    function commitState(s: number, tx: number, ty: number) {
        const finalScale = s <= 1.05 ? 1 : Math.min(MAX_SCALE, s);
        const clamped = clampTranslate(finalScale, tx, ty);
        scaleRef.current = finalScale;
        translateRef.current = clamped;
        applyTransform(finalScale, clamped.x, clamped.y);
        setScale(finalScale);
        setTranslate(clamped);
    }

    const reset = useCallback(() => {
        scaleRef.current = 1;
        translateRef.current = { x: 0, y: 0 };
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        const el = containerRef.current;
        if (el) {
            el.style.transition = 'transform 200ms ease-out';
            el.style.transform = 'scale(1) translate(0px, 0px)';
            setTimeout(() => {
                if (el) el.style.transition = '';
            }, 200);
        }
    }, [containerRef]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        function handleTouchStart(e: TouchEvent) {
            if (e.touches.length === 2) {
                // Pinch start
                isPinching.current = true;
                isPanning.current = false;
                pinchBaseDistance.current = getTouchDistance(e.touches[0], e.touches[1]);
                pinchBaseScale.current = scaleRef.current;
                pinchBaseTranslate.current = { ...translateRef.current };
                pinchBaseCenter.current = getTouchCenter(e.touches[0], e.touches[1]);

                // Compute focal point in the element's untransformed coordinate space.
                // Use offsetWidth/Height (unaffected by CSS transforms) to avoid drift.
                const el = containerRef.current;
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const s = scaleRef.current;
                    const t = translateRef.current;
                    const center = pinchBaseCenter.current;
                    // Map screen coords → untransformed element coords
                    // rect center = element center in screen space
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    pinchFocalPoint.current = {
                        x: (center.x - cx) / s - t.x,
                        y: (center.y - cy) / s - t.y,
                    };
                }
            }
            else if (e.touches.length === 1 && scaleRef.current > 1.05) {
                // Pan start (only when zoomed)
                isPanning.current = true;
                panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                panBaseTranslate.current = { ...translateRef.current };
            }
        }

        function handleTouchMove(e: TouchEvent) {
            if (isPinching.current && e.touches.length === 2) {
                e.preventDefault();
                cancelAnimationFrame(rafId.current);
                rafId.current = requestAnimationFrame(() => {
                    const dist = getTouchDistance(e.touches[0], e.touches[1]);
                    const newScale = Math.max(
                        MIN_SCALE * 0.5,
                        Math.min(MAX_SCALE, pinchBaseScale.current * (dist / pinchBaseDistance.current))
                    );

                    // Keep the focal point (computed at pinch start) stationary on screen.
                    // The transform is: screen = elementCenter + scale * (point + translate)
                    // We want the focal point to stay at the same screen position as at pinch start.
                    // focalScreen = s_base * (focal + t_base)  =>  focal + t_new = (s_base/s_new) * (focal + t_base)
                    const fp = pinchFocalPoint.current;
                    const sBase = pinchBaseScale.current;
                    const tBase = pinchBaseTranslate.current;
                    const ratio = sBase / newScale;
                    const tx = ratio * (fp.x + tBase.x) - fp.x;
                    const ty = ratio * (fp.y + tBase.y) - fp.y;

                    scaleRef.current = newScale;
                    translateRef.current = { x: tx, y: ty };
                    applyTransform(newScale, tx, ty);
                });
                return;
            }

            if (isPanning.current && e.touches.length === 1) {
                e.preventDefault();
                cancelAnimationFrame(rafId.current);
                rafId.current = requestAnimationFrame(() => {
                    const dx = e.touches[0].clientX - panStart.current.x;
                    const dy = e.touches[0].clientY - panStart.current.y;
                    const s = scaleRef.current;
                    const tx = panBaseTranslate.current.x + dx / s;
                    const ty = panBaseTranslate.current.y + dy / s;
                    const clamped = clampTranslate(s, tx, ty);
                    translateRef.current = clamped;
                    applyTransform(s, clamped.x, clamped.y);
                });
                return;
            }
        }

        function handleTouchEnd(e: TouchEvent) {
            if (isPinching.current && e.touches.length < 2) {
                isPinching.current = false;
                commitState(scaleRef.current, translateRef.current.x, translateRef.current.y);

                // If a finger remains, start panning from it
                if (e.touches.length === 1 && scaleRef.current > 1.05) {
                    isPanning.current = true;
                    panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    panBaseTranslate.current = { ...translateRef.current };
                }
                return;
            }

            if (isPanning.current) {
                isPanning.current = false;
                commitState(scaleRef.current, translateRef.current.x, translateRef.current.y);
            }

            // Double-tap detection (single finger end, no pinch)
            if (e.changedTouches.length === 1 && !isPinching.current) {
                const touch = e.changedTouches[0];
                const now = Date.now();
                const dt = now - lastTapTime.current;
                const dist = Math.hypot(
                    touch.clientX - lastTapX.current,
                    touch.clientY - lastTapY.current
                );

                if (dt < DOUBLE_TAP_MS && dist < 30) {
                    // Double tap detected
                    lastTapTime.current = 0;
                    const el = containerRef.current;
                    if (!el) return;

                    if (scaleRef.current > 1.05) {
                        // Zoom out
                        el.style.transition = 'transform 200ms ease-out';
                        applyTransform(1, 0, 0);
                        setTimeout(() => {
                            el.style.transition = '';
                            commitState(1, 0, 0);
                        }, 200);
                    }
                    else {
                        // Zoom in to tap point
                        const rect = el.getBoundingClientRect();
                        const originX = (touch.clientX - rect.left - rect.width / 2) / 1;
                        const originY = (touch.clientY - rect.top - rect.height / 2) / 1;
                        const tx = -originX * ((DOUBLE_TAP_SCALE - 1) / DOUBLE_TAP_SCALE);
                        const ty = -originY * ((DOUBLE_TAP_SCALE - 1) / DOUBLE_TAP_SCALE);
                        const clamped = clampTranslate(DOUBLE_TAP_SCALE, tx, ty);
                        el.style.transition = 'transform 200ms ease-out';
                        applyTransform(DOUBLE_TAP_SCALE, clamped.x, clamped.y);
                        setTimeout(() => {
                            el.style.transition = '';
                            commitState(DOUBLE_TAP_SCALE, clamped.x, clamped.y);
                        }, 200);
                    }
                }
                else {
                    lastTapTime.current = now;
                    lastTapX.current = touch.clientX;
                    lastTapY.current = touch.clientY;
                }
            }
        }

        function handleTouchCancel() {
            isPinching.current = false;
            isPanning.current = false;
            commitState(scaleRef.current, translateRef.current.x, translateRef.current.y);
        }

        /**
         * Pointer/wheel handlers for desktop.
         *
         * This hook previously bound touch events *only*, so zoom and pan were
         * completely unreachable with a mouse, trackpad or keyboard — on desktop the
         * full-resolution layer could never be shown at all.
         */

        function zoomAround(clientX: number, clientY: number, nextScale: number) {
            const rect = el!.getBoundingClientRect();
            const target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));

            if (target <= 1.05) {
                commitState(1, 0, 0);
                return;
            }

            // Keep the point under the cursor fixed while the scale changes.
            const focalX = (clientX - rect.left - rect.width / 2) / scaleRef.current
                - translateRef.current.x;
            const focalY = (clientY - rect.top - rect.height / 2) / scaleRef.current
                - translateRef.current.y;

            const tx = -focalX * (1 - 1 / target) + translateRef.current.x / target;
            const ty = -focalY * (1 - 1 / target) + translateRef.current.y / target;

            commitState(target, tx, ty);
        }

        function handleWheel(e: WheelEvent) {
            // Trackpad pinch and ctrl+wheel are the conventional zoom gestures; a
            // plain wheel is left alone so it can still scroll the page.
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const factor = Math.exp(-e.deltaY / 300);
            zoomAround(e.clientX, e.clientY, scaleRef.current * factor);
        }

        function handleDoubleClick(e: MouseEvent) {
            e.preventDefault();
            zoomAround(
                e.clientX,
                e.clientY,
                scaleRef.current > 1.05 ? 1 : DOUBLE_TAP_SCALE
            );
        }

        function handlePointerDown(e: PointerEvent) {
            // Primary button only, and only meaningful once zoomed in.
            if (e.pointerType === 'touch' || e.button !== 0) return;
            if (scaleRef.current <= 1.05) return;

            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY };
            panBaseTranslate.current = { ...translateRef.current };
            el!.setPointerCapture(e.pointerId);
            el!.style.cursor = 'grabbing';
        }

        function handlePointerMove(e: PointerEvent) {
            if (!isPanning.current || e.pointerType === 'touch') return;
            const dx = (e.clientX - panStart.current.x) / scaleRef.current;
            const dy = (e.clientY - panStart.current.y) / scaleRef.current;
            const next = clampTranslate(
                scaleRef.current,
                panBaseTranslate.current.x + dx,
                panBaseTranslate.current.y + dy
            );
            translateRef.current = next;
            // rAF-coalesced: pointermove fires far more often than the display
            // refreshes, and each raw event would otherwise write a style.
            cancelAnimationFrame(rafId.current);
            rafId.current = requestAnimationFrame(() =>
                applyTransform(scaleRef.current, next.x, next.y)
            );
        }

        function handlePointerUp(e: PointerEvent) {
            if (!isPanning.current || e.pointerType === 'touch') return;
            isPanning.current = false;
            el!.style.cursor = '';
            if (el!.hasPointerCapture(e.pointerId)) el!.releasePointerCapture(e.pointerId);
            commitState(scaleRef.current, translateRef.current.x, translateRef.current.y);
        }

        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });
        el.addEventListener('touchcancel', handleTouchCancel, { passive: true });
        // passive:false because handleWheel calls preventDefault to stop the
        // browser's own page zoom taking over.
        el.addEventListener('wheel', handleWheel, { passive: false });
        el.addEventListener('dblclick', handleDoubleClick);
        el.addEventListener('pointerdown', handlePointerDown);
        el.addEventListener('pointermove', handlePointerMove);
        el.addEventListener('pointerup', handlePointerUp);
        el.addEventListener('pointercancel', handlePointerUp);

        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
            el.removeEventListener('touchcancel', handleTouchCancel);
            el.removeEventListener('wheel', handleWheel);
            el.removeEventListener('dblclick', handleDoubleClick);
            el.removeEventListener('pointerdown', handlePointerDown);
            el.removeEventListener('pointermove', handlePointerMove);
            el.removeEventListener('pointerup', handlePointerUp);
            el.removeEventListener('pointercancel', handlePointerUp);
            cancelAnimationFrame(rafId.current);
        };
    }, [containerRef, enabled]);

    const containerStyle: CSSProperties = {
        transform: `scale(${scale}) translate(${translate.x}px, ${translate.y}px)`,
        transformOrigin: 'center center',
        touchAction: isZoomed ? 'none' : undefined,
        willChange: isZoomed ? 'transform' : undefined,
        // Signals to a mouse user that the zoomed image can be dragged. Without any
        // desktop affordance, zoom was not merely hard to find — it did not exist.
        cursor: isZoomed ? 'grab' : undefined,
    };

    return { containerStyle, isZoomed, reset };
}
