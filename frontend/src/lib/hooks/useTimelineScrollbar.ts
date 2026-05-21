'use client';

import { useState, useCallback, useEffect, useRef, useMemo, type RefObject } from 'react';
import {
    buildTimelineMarkers,
    findCurrentDate,
    findMarkerAtFraction,
    formatDateLabel,
    type TimelineMarker,
} from '@/lib/utils/timelineMarkers';
import type { TimelineMonth } from '@/lib/api/media';
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

            const currentDate = findCurrentDate(virtualRows, container.scrollTop);
            if (currentDate) {
                setActiveLabel(formatDateLabel(currentDate));
            }
        };

        const handleScroll = () => {
            if (rafRef.current !== null) return;
            rafRef.current = requestAnimationFrame(() => {
                updatePosition();
                rafRef.current = null;
            });

            setIsScrolling(true);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => {
                setIsScrolling(false);
                scrollTimeoutRef.current = null;
            }, 1200);
        };

        updatePosition();
        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [containerRef, markers, virtualRows]);

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
        const currentDate = findCurrentDate(virtualRows, container.scrollTop);
        if (currentDate) {
            setActiveLabel(formatDateLabel(currentDate));
        }
        else {
            const marker = findMarkerAtFraction(markers, fraction);
            setActiveLabel(marker?.label ?? null);
        }
    }, [containerRef, markers, virtualRows]);

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
        markers,
        trackRef,
        onTrackPointerDown,
        canShow,
        wrapperHeight,
    };
}
