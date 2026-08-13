'use client';

import { useState, useCallback, useEffect, useRef, useMemo, type RefObject } from 'react';
import {
    buildTimelineMarkers,
    buildDateIndex,
    findCurrentDateBinary,
    findMarkerAtFraction,
    type TimelineMarker,
} from '@/lib/utils/timelineMarkers';
import { formatDate } from '@/lib/utils/format';
import type { TimelineMonth } from '@/lib/types/media';
import type { VirtualRow } from '@/components/gallery/GalleryGrid';

interface UseTimelineScrollbarResult {
    isVisible: boolean;
    isDragging: boolean;
    thumbFraction: number;
    activeLabel: string | null;
    markers: TimelineMarker[];
    trackRef: RefObject<HTMLDivElement | null>;
    onTrackPointerDown: (e: React.PointerEvent) => void;
    canShow: boolean;
    wrapperHeight: number;
}

export function useTimelineScrollbar(
    containerRef: RefObject<HTMLDivElement | null>,
    virtualRows: VirtualRow[],
    timeline: TimelineMonth[] | undefined,
): UseTimelineScrollbarResult {
    const [thumbFraction, setThumbFraction] = useState(0);
    const [activeLabel, setActiveLabel] = useState<string | null>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [canShow, setCanShow] = useState(false);
    const [isScrolling, setIsScrolling] = useState(false);
    const [wrapperHeight, setWrapperHeight] = useState(0);

    const trackRef = useRef<HTMLDivElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    /** Detaches an in-flight drag's document listeners; see the drag effect below. */
    const activeDragCleanupRef = useRef<(() => void) | null>(null);
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Drag throttling: latest fraction + pending frame, separate from rafRef so
    // drag and scroll rAF callbacks never clobber each other.
    const dragRafRef = useRef<number | null>(null);
    const dragFractionRef = useRef(0);
    // Last label we committed via setActiveLabel — lets us skip redundant
    // setState when the day label is unchanged between frames.
    const lastLabelRef = useRef<string | null>(null);

    // Single label setter shared by the scroll + drag paths so lastLabelRef
    // stays in sync with the rendered label.
    const commitLabel = useCallback((next: string | null) => {
        if (next === lastLabelRef.current) return;
        lastLabelRef.current = next;
        setActiveLabel(next);
    }, []);

    const markers = useMemo(
        () => buildTimelineMarkers(timeline ?? []),
        [timeline],
    );

    const dateIndex = useMemo(
        () => buildDateIndex(virtualRows),
        [virtualRows],
    );

    // Correct marker fractions to use actual scroll positions instead of item-count ratios.
    // Item-count fractions drift from scroll fractions because date-headers (40px each)
    // add height that isn't proportional to item counts.
    const correctedMarkers = useMemo(() => {
        if (markers.length === 0 || dateIndex.length === 0) return markers;

        // Map each month to its first scroll position
        const monthScrollMap = new Map<string, number>();
        for (const entry of dateIndex) {
            const monthKey = entry.date.substring(0, 7);
            if (!monthScrollMap.has(monthKey)) {
                monthScrollMap.set(monthKey, entry.scrollTop);
            }
        }

        const totalHeight = virtualRows.reduce((sum, r) => sum + r.height, 0);
        const maxScroll = totalHeight - wrapperHeight;
        if (maxScroll <= 0) return markers;

        return markers.map(marker => {
            const scrollTop = monthScrollMap.get(marker.monthKey);
            if (scrollTop === undefined) return marker;
            return { ...marker, fraction: Math.max(0, Math.min(1, scrollTop / maxScroll)) };
        });
    }, [markers, dateIndex, virtualRows, wrapperHeight]);

    // Measure container height
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const measure = () => {
            setWrapperHeight(container.clientHeight);
            setCanShow(container.scrollHeight > container.clientHeight + 10);
        };
        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [containerRef, virtualRows]);

    // Track scroll position → thumb fraction (direct 1:1 mapping)
    useEffect(() => {
        const container = containerRef.current;
        if (!container || markers.length === 0) return;

        const updatePosition = () => {
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll <= 0) return;

            const fraction = container.scrollTop / maxScroll;
            setThumbFraction(Math.max(0, Math.min(1, fraction)));

            const currentDate = findCurrentDateBinary(dateIndex, container.scrollTop);
            if (currentDate) {
                commitLabel(formatDate(currentDate));
            }
        };

        const handleScroll = () => {
            if (rafRef.current !== null) return;
            rafRef.current = requestAnimationFrame(() => {
                updatePosition();
                setIsScrolling(true);
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                scrollTimeoutRef.current = setTimeout(() => {
                    setIsScrolling(false);
                    scrollTimeoutRef.current = null;
                }, 1200);
                rafRef.current = null;
            });
        };

        updatePosition();
        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [containerRef, markers, dateIndex, commitLabel]);

    // Hover detection
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        /**
         * The rect is cached and refreshed on resize/scroll rather than read per event.
         *
         * getBoundingClientRect forces a synchronous layout, and this listener is on
         * `document` for the gallery's entire lifetime — so it fired during trackpad
         * scrolling, interleaved with the virtualizer writing DOM, which is exactly the
         * read-after-write pattern that produces layout thrash.
         */
        let rect = container.getBoundingClientRect();
        const refreshRect = () => {
            rect = container.getBoundingClientRect();
        };

        const observer = new ResizeObserver(refreshRect);
        observer.observe(container);
        window.addEventListener('resize', refreshRect, { passive: true });
        window.addEventListener('scroll', refreshRect, { passive: true, capture: true });

        const handleMouseMove = (e: MouseEvent) => {
            const nearRightEdge = e.clientX > rect.right - 60 && e.clientX <= rect.right;
            const insideVertical = e.clientY >= rect.top && e.clientY <= rect.bottom;

            if (nearRightEdge && insideVertical) {
                if (hideTimeoutRef.current) {
                    clearTimeout(hideTimeoutRef.current);
                    hideTimeoutRef.current = null;
                }
                setIsHovering(true);
            }
            else if (!isDraggingRef.current) {
                if (!hideTimeoutRef.current) {
                    hideTimeoutRef.current = setTimeout(() => {
                        setIsHovering(false);
                        hideTimeoutRef.current = null;
                    }, 400);
                }
            }
        };

        const handleMouseLeave = () => {
            if (!isDraggingRef.current) {
                hideTimeoutRef.current = setTimeout(() => {
                    setIsHovering(false);
                    hideTimeoutRef.current = null;
                }, 400);
            }
        };

        document.addEventListener('mousemove', handleMouseMove, { passive: true });
        container.addEventListener('mouseleave', handleMouseLeave);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            container.removeEventListener('mouseleave', handleMouseLeave);
            window.removeEventListener('resize', refreshRect);
            window.removeEventListener('scroll', refreshRect, { capture: true });
            observer.disconnect();
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, [containerRef]);

    // Apply a target fraction to the scroll container — writes scrollTop and
    // updates the thumb + day label. Called synchronously on pointer-down and
    // at most once per frame during drag (see scheduleDragFrame).
    const applyFraction = useCallback((fraction: number) => {
        const container = containerRef.current;
        if (!container) return;

        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;

        container.scrollTop = fraction * maxScroll;
        setThumbFraction(fraction);

        // Show day-level label during drag
        const currentDate = findCurrentDateBinary(dateIndex, container.scrollTop);
        const nextLabel = currentDate
            ? formatDate(currentDate)
            : (findMarkerAtFraction(correctedMarkers, fraction)?.label ?? null);
        commitLabel(nextLabel);
    }, [containerRef, correctedMarkers, dateIndex, commitLabel]);

    // rAF-throttle drag updates: pointermove fires far more often than the
    // display refreshes, so coalesce to at most one scrollTop write per frame.
    const scheduleDragFrame = useCallback((fraction: number) => {
        dragFractionRef.current = fraction;
        if (dragRafRef.current !== null) return;
        dragRafRef.current = requestAnimationFrame(() => {
            dragRafRef.current = null;
            applyFraction(dragFractionRef.current);
        });
    }, [applyFraction]);

    // Cancel any pending drag frame on unmount
    useEffect(() => () => {
        if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current);
    }, []);

    // Drag handling
    const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const track = trackRef.current;
        if (!track) return;

        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        isDraggingRef.current = true;
        setIsDragging(true);

        const trackRect = track.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientY - trackRect.top) / trackRect.height));
        applyFraction(fraction); // immediate feedback on the initial jump

        const handlePointerMove = (ev: PointerEvent) => {
            if (!isDraggingRef.current) return;
            const rect = track.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
            scheduleDragFrame(f);
        };

        const handlePointerUp = () => {
            isDraggingRef.current = false;
            setIsDragging(false);
            if (dragRafRef.current !== null) {
                // A frame was pending with the latest fraction not yet applied;
                // commit it once so the resting position matches the release
                // point (pointerup can win the race against the queued rAF).
                cancelAnimationFrame(dragRafRef.current);
                dragRafRef.current = null;
                applyFraction(dragFractionRef.current);
            }
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
            activeDragCleanupRef.current = null;
        };

        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        /**
         * pointercancel was not handled, so an interrupted drag — the browser taking over
         * the gesture, a phone call arriving, the pointer being captured elsewhere — left
         * both document listeners attached for the lifetime of the page, still writing
         * scrollTop on every subsequent pointer move.
         */
        document.addEventListener('pointercancel', handlePointerUp);

        // Recorded so unmounting mid-drag also detaches them.
        activeDragCleanupRef.current = () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [applyFraction, scheduleDragFrame]);

    // A drag in flight when the gallery unmounts would otherwise leak its listeners.
    useEffect(
        () => () => {
            activeDragCleanupRef.current?.();
            activeDragCleanupRef.current = null;
        },
        []
    );

    const isVisible = (isHovering || isDragging || isScrolling) && canShow && markers.length > 0;

    return {
        isVisible,
        isDragging,
        thumbFraction,
        activeLabel,
        markers: correctedMarkers,
        trackRef,
        onTrackPointerDown,
        canShow,
        wrapperHeight,
    };
}
