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
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                setActiveLabel(formatDate(currentDate));
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
    }, [containerRef, markers, dateIndex]);

    // Hover detection
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleMouseMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
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
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, [containerRef]);

    // Scroll to a target fraction — direct mapping, instant jump
    const scrollToTimelineFraction = useCallback((fraction: number) => {
        const container = containerRef.current;
        if (!container) return;

        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;

        container.scrollTop = fraction * maxScroll;
        setThumbFraction(fraction);

        // Show day-level label during drag
        const currentDate = findCurrentDateBinary(dateIndex, container.scrollTop);
        if (currentDate) {
            setActiveLabel(formatDate(currentDate));
        }
        else {
            const marker = findMarkerAtFraction(correctedMarkers, fraction);
            setActiveLabel(marker?.label ?? null);
        }
    }, [containerRef, correctedMarkers, dateIndex]);

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
        scrollToTimelineFraction(fraction);

        const handlePointerMove = (ev: PointerEvent) => {
            if (!isDraggingRef.current) return;
            const rect = track.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
            scrollToTimelineFraction(f);
        };

        const handlePointerUp = () => {
            isDraggingRef.current = false;
            setIsDragging(false);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
        };

        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
    }, [scrollToTimelineFraction]);

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
