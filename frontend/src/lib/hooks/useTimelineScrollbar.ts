'use client';

import { useState, useCallback, useEffect, useRef, useMemo, type RefObject } from 'react';
import {
    buildTimelineMarkers,
    buildDateIndex,
    buildRowItemIndex,
    findCurrentDateBinary,
    findMarkerAtFraction,
    itemIndexAtScrollTop,
    scrollTopForItemIndex,
    totalItemsInTimeline,
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

interface UseTimelineScrollbarOptions {
    /** Whether pages exist beyond the loaded rows. */
    hasMore?: boolean;
    /** Requests the next page. Called repeatedly while chasing a jump target. */
    onLoadMore?: () => void;
}

/**
 * The timeline scrollbar, addressed by *item index* rather than by a fraction of
 * the scroll container.
 *
 * The distinction is the whole point once the gallery is paginated. The markers
 * describe the entire library (`/media/timeline` month counts) while the scroll
 * container only spans the pages fetched so far, so writing
 * `scrollTop = fraction * scrollHeight` aimed at the wrong content: dragging to
 * "May" landed at May's fraction *of the newest 2000 items*, i.e. still in July.
 * With thousands of older photos unreachable that way, the library looked like it
 * only held July and August.
 *
 * Now a fraction resolves to a global item index. If that item's page is loaded we
 * scroll straight to its row; if not, the index is parked in `pendingIndexRef` and
 * pages are pulled until it arrives.
 */
export function useTimelineScrollbar(
    containerRef: RefObject<HTMLDivElement | null>,
    virtualRows: VirtualRow[],
    timeline: TimelineMonth[] | undefined,
    { hasMore = false, onLoadMore }: UseTimelineScrollbarOptions = {},
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
    /**
     * Global item index the user asked for that is not loaded yet. Pages are
     * fetched until it materialises, then we land on it. Cleared if the user takes
     * over with the wheel, or if the library runs out before reaching it.
     */
    const pendingIndexRef = useRef<number | null>(null);

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

    const rowIndex = useMemo(
        () => buildRowItemIndex(virtualRows),
        [virtualRows],
    );

    /**
     * Items the track spans. The timeline covers the whole library; the loaded row
     * count is the floor for callers whose timeline is derived from loaded items
     * only (collection views), where the two are the same number by construction.
     *
     * Marker fractions are used as published. They were previously rewritten from
     * loaded-only scroll positions, which mixed two coordinate systems once
     * pagination landed: loaded months got scroll-derived fractions while unloaded
     * ones kept item-count fractions, so labels bunched together and moved on every
     * page load. Item-count fractions are the same basis the drag now resolves
     * against, so no correction is needed — and date-header height, the reason the
     * correction existed, no longer distorts anything because a fraction maps to a
     * row rather than to a pixel offset.
     */
    const totalItems = Math.max(totalItemsInTimeline(timeline), rowIndex.loadedItems);

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

            // The drag owns the thumb while it is in progress, and a jump in flight
            // owns it until its target page arrives — otherwise the position the
            // user chose would be overwritten by the loaded-content position we are
            // temporarily parked at.
            if (!isDraggingRef.current && pendingIndexRef.current === null) {
                const atEnd = maxScroll - container.scrollTop < 2;
                const fraction = atEnd && !hasMore
                    ? 1
                    : totalItems > 1
                        ? itemIndexAtScrollTop(rowIndex, container.scrollTop) / (totalItems - 1)
                        : 0;
                setThumbFraction(Math.max(0, Math.min(1, fraction)));
            }

            const currentDate = findCurrentDateBinary(dateIndex, container.scrollTop);
            if (currentDate) {
                commitLabel(formatDate(currentDate));
            }
        };

        // A deliberate scroll by the user supersedes a jump that is still fetching
        // its pages; without this the grid would yank them away mid-scroll when the
        // target finally arrived.
        const cancelPendingJump = () => {
            pendingIndexRef.current = null;
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
        container.addEventListener('wheel', cancelPendingJump, { passive: true });
        container.addEventListener('touchstart', cancelPendingJump, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            container.removeEventListener('wheel', cancelPendingJump);
            container.removeEventListener('touchstart', cancelPendingJump);
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [containerRef, markers, dateIndex, rowIndex, totalItems, hasMore, commitLabel]);

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

    /**
     * Resolve a track fraction to a library item and go there. Called
     * synchronously on pointer-down and at most once per frame during a drag
     * (see scheduleDragFrame).
     */
    const applyFraction = useCallback((fraction: number) => {
        const container = containerRef.current;
        if (!container) return;

        const clamped = Math.max(0, Math.min(1, fraction));
        setThumbFraction(clamped);
        if (totalItems <= 0) return;

        const targetIndex = Math.min(totalItems - 1, Math.round(clamped * (totalItems - 1)));
        const scrollTop = scrollTopForItemIndex(rowIndex, targetIndex);

        if (scrollTop === null) {
            // The target is in a page we have not fetched. Hold it, park at the end
            // of the loaded content so pages keep streaming, and land on it in the
            // effect below as soon as it arrives.
            pendingIndexRef.current = targetIndex;
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll > 0 && container.scrollTop < maxScroll) container.scrollTop = maxScroll;
            commitLabel(findMarkerAtFraction(markers, clamped)?.label ?? null);
            onLoadMore?.();
            return;
        }

        pendingIndexRef.current = null;
        container.scrollTop = scrollTop;

        const currentDate = findCurrentDateBinary(dateIndex, scrollTop);
        commitLabel(
            currentDate
                ? formatDate(currentDate)
                : (findMarkerAtFraction(markers, clamped)?.label ?? null)
        );
    }, [containerRef, markers, dateIndex, rowIndex, totalItems, onLoadMore, commitLabel]);

    /**
     * Chase a jump target across page loads.
     *
     * Re-runs on every new page (`rowIndex` changes), landing on the target the
     * moment its page is in, and giving up cleanly if the library ends first.
     */
    useEffect(() => {
        const target = pendingIndexRef.current;
        if (target === null) return;

        const container = containerRef.current;
        if (!container) return;

        const scrollTop = scrollTopForItemIndex(rowIndex, target);
        if (scrollTop !== null) {
            pendingIndexRef.current = null;
            container.scrollTop = scrollTop;
            const currentDate = findCurrentDateBinary(dateIndex, scrollTop);
            if (currentDate) commitLabel(formatDate(currentDate));
            return;
        }

        if (hasMore) {
            onLoadMore?.();
        }
        else {
            // Ran out of library before reaching the target — settle at the end.
            pendingIndexRef.current = null;
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll > 0) container.scrollTop = maxScroll;
        }
    }, [containerRef, rowIndex, dateIndex, hasMore, onLoadMore, commitLabel]);

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
        markers,
        trackRef,
        onTrackPointerDown,
        canShow,
        wrapperHeight,
    };
}
