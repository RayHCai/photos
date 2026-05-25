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

export function usePinchToZoom(
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean,
    availableWidth: number,
    gap: number
) {
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [gestureCellSize, setGestureCellSize] = useState<number | null>(null);

    // Refs for stable event handlers (avoid re-registering listeners during gesture)
    const isPinching = useRef(false);
    const baseDistance = useRef(0);
    const baseCellSize = useRef(0);
    const rafId = useRef(0);
    const wheelAccumulator = useRef(0);

    const colsRef = useRef(columns);
    colsRef.current = columns;
    const cellSizeRef = useRef(gestureCellSize);
    cellSizeRef.current = gestureCellSize;
    const widthRef = useRef(availableWidth);
    widthRef.current = availableWidth;
    const gapRef = useRef(gap);
    gapRef.current = gap;

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                isPinching.current = true;
                baseDistance.current = getTouchDistance(e.touches[0], e.touches[1]);
                const cols = colsRef.current;
                const gcs = cellSizeRef.current;
                const w = widthRef.current;
                const g = gapRef.current;
                baseCellSize.current = gcs ?? (w - (cols - 1) * g) / cols;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!isPinching.current || e.touches.length !== 2) return;
            e.preventDefault();

            cancelAnimationFrame(rafId.current);
            rafId.current = requestAnimationFrame(() => {
                const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
                const scale = currentDist / baseDistance.current;
                const newSize = baseCellSize.current * scale;

                const w = widthRef.current;
                const g = gapRef.current;
                const maxSize = (w - (MIN_COLUMNS - 1) * g) / MIN_COLUMNS;
                const minSize = (w - (MAX_COLUMNS - 1) * g) / MAX_COLUMNS;
                const clamped = Math.max(minSize, Math.min(maxSize, newSize));

                // Derive best column count from current cell size
                const bestCols = Math.round((w + g) / (clamped + g));
                const clampedCols = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, bestCols));

                setGestureCellSize(clamped);
                setColumns(clampedCols);
            });
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {
                isPinching.current = false;
                cancelAnimationFrame(rafId.current);
                setGestureCellSize(null);
            }
        };

        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
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
        el.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('wheel', onWheel);
            cancelAnimationFrame(rafId.current);
        };
    }, [containerRef, enabled]);

    return { columns, gestureCellSize };
}
