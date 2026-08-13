'use client';

import { useEffect, useRef, useState } from 'react';

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = 2;
const WHEEL_THRESHOLD = 80;

function getTouchDistance(t1: Touch, t2: Touch): number {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pinch to change grid density.
 *
 * The gesture is now *visual only* while the fingers are down: it reports a
 * `gestureScale` the caller applies as a CSS transform, and commits a new column
 * count once on release.
 *
 * Previously it drove `setColumns` and a `gestureCellSize` on every rAF during the
 * gesture, both of which fed the caller's layout memo — so each frame re-ran the
 * whole library's date grouping and justified layout, re-measured the virtualizer,
 * re-armed the thumbnail prefetcher, and made the timeline scrollbar rebuild its
 * index while reading clientHeight. The result on the low-end phones this feature
 * exists for was that the pinch did not animate at all: the grid froze for the
 * duration and snapped to a new density seconds after the fingers lifted.
 */
export function usePinchToZoom(
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean,
    availableWidth: number,
    gap: number
) {
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    /** Live visual scale during a pinch, or null when no gesture is in flight. */
    const [gestureScale, setGestureScale] = useState<number | null>(null);
    const [isPinching, setIsPinching] = useState(false);

    const pinchingRef = useRef(false);
    const baseDistance = useRef(0);
    const rafId = useRef(0);
    const wheelAccumulator = useRef(0);
    /** Latest scale seen during the gesture, used to decide the committed columns. */
    const latestScale = useRef(1);

    const colsRef = useRef(columns);
    colsRef.current = columns;
    const widthRef = useRef(availableWidth);
    widthRef.current = availableWidth;
    const gapRef = useRef(gap);
    gapRef.current = gap;

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 2) return;
            pinchingRef.current = true;
            baseDistance.current = getTouchDistance(e.touches[0]!, e.touches[1]!);
            latestScale.current = 1;
            setIsPinching(true);
            setGestureScale(1);
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!pinchingRef.current || e.touches.length !== 2) return;
            e.preventDefault();

            // Read the touch positions synchronously: by the time a rAF callback runs
            // the TouchEvent's touch list may already have been recycled.
            const distance = getTouchDistance(e.touches[0]!, e.touches[1]!);

            cancelAnimationFrame(rafId.current);
            rafId.current = requestAnimationFrame(() => {
                if (baseDistance.current === 0) return;
                // Clamped to the range the column count can actually express, so the
                // visual feedback never promises a density that will not be committed.
                const raw = distance / baseDistance.current;
                const scale = Math.max(0.5, Math.min(2.5, raw));
                latestScale.current = scale;
                setGestureScale(scale);
            });
        };

        const commit = () => {
            pinchingRef.current = false;
            cancelAnimationFrame(rafId.current);

            const w = widthRef.current;
            const g = gapRef.current;
            const cols = colsRef.current;

            // Translate the final scale into a column count once.
            const currentCellSize = (w - (cols - 1) * g) / cols;
            const targetCellSize = currentCellSize * latestScale.current;
            const bestCols = Math.round((w + g) / (targetCellSize + g));
            const clampedCols = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, bestCols));

            setGestureScale(null);
            setIsPinching(false);
            setColumns(clampedCols);
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2 && pinchingRef.current) commit();
        };

        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            wheelAccumulator.current += e.deltaY;
            if (Math.abs(wheelAccumulator.current) >= WHEEL_THRESHOLD) {
                const step = wheelAccumulator.current > 0 ? 1 : -1;
                wheelAccumulator.current = 0;
                setColumns((prev) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, prev + step)));
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchEnd, { passive: true });
        el.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
            el.removeEventListener('wheel', onWheel);
            cancelAnimationFrame(rafId.current);
        };
    }, [containerRef, enabled]);

    return { columns, gestureScale, isPinching };
}
