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
    /** A jump is waiting on the pages that hold its target. */
    isJumping: boolean;
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
    /** Requests the next page. The fallback when `onSeekToIndex` is absent. */
    onLoadMore?: () => void;
    /**
     * Loads the page holding a global item index directly, skipping the ones in
     * between. Rejects if the fetch fails.
     */
    onSeekToIndex?: (index: number) => Promise<void>;
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
 * A fraction therefore resolves to a global item index. If that item's page is
 * loaded we scroll straight to its row. If it is not, the index is parked in
 * `pendingIndexRef`, `onSeekToIndex` fetches the pages that hold it, and the
 * landing happens once — in the effect below — when they arrive.
 *
 * What deliberately does *not* happen in the meantime is any movement of the
 * viewport. It used to be parked at the end of the loaded content while pages
 * streamed in, so a jump to May 2023 visibly landed at the bottom of page 2,
 * scrolled through every page after it, and only then arrived at the date asked
 * for. Holding still and landing once is the difference.
 */
export function useTimelineScrollbar(
    containerRef: RefObject<HTMLDivElement | null>,
    virtualRows: VirtualRow[],
    timeline: TimelineMonth[] | undefined,
    { hasMore = false, onLoadMore, onSeekToIndex }: UseTimelineScrollbarOptions = {},
): UseTimelineScrollbarResult {
    const [thumbFraction, setThumbFraction] = useState(0);
    const [activeLabel, setActiveLabel] = useState<string | null>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isJumping, setIsJumping] = useState(false);
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
    /** A batch of pages for the pending jump is on its way. */
    const seekPendingRef = useRef(false);
    /** Loaded item count the last batch was requested at; see `requestPages`. */
    const lastSeekAtRef = useRef(-1);

    // Single label setter shared by the scroll + drag paths so lastLabelRef
    // stays in sync with the rendered label.
    const commitLabel = useCallback((next: string | null) => {
        if (next === lastLabelRef.current) return;
        lastLabelRef.current = next;
        setActiveLabel(next);
    }, []);

    /**
     * The ref is what the scroll handler reads synchronously; the state is what
     * keeps the bar and its tooltip on screen while the pages arrive. Always
     * written together.
     */
    const setPendingIndex = useCallback((next: number | null) => {
        pendingIndexRef.current = next;
        // A fresh jump gets to ask for pages again even from the same loaded count.
        if (next !== null) lastSeekAtRef.current = -1;
        setIsJumping(next !== null);
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

    /** Put the thumb where the container is actually scrolled to. */
    const resyncThumb = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll <= 0) return;

        const atEnd = maxScroll - container.scrollTop < 2;
        const fraction = atEnd && !hasMore
            ? 1
            : totalItems > 1
                ? itemIndexAtScrollTop(rowIndex, container.scrollTop) / (totalItems - 1)
                : 0;
        setThumbFraction(Math.max(0, Math.min(1, fraction)));
    }, [containerRef, rowIndex, totalItems, hasMore]);

    // Track scroll position → thumb fraction (direct 1:1 mapping)
    useEffect(() => {
        const container = containerRef.current;
        if (!container || markers.length === 0) return;

        const updatePosition = () => {
            // The drag owns the thumb while it is in progress, and a jump in flight
            // owns it until its target page arrives — otherwise the position the
            // user chose would be overwritten by the position of whatever content
            // happens to be loaded.
            if (!isDraggingRef.current && pendingIndexRef.current === null) {
                resyncThumb();
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
            setPendingIndex(null);
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
    }, [containerRef, markers, dateIndex, resyncThumb, setPendingIndex, commitLabel]);

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
     * Pull the pages holding a target that is not loaded.
     *
     * `onSeekToIndex` addresses the page directly; without it (collection views,
     * whose timeline is derived from the loaded items and so never points past
     * them) the only route is the next page.
     *
     * Two guards, because the caller is an effect that re-runs on every data
     * change: one batch at a time, and never twice from the same loaded count. A
     * seek that comes back with nothing new — the library shrank mid-jump, so the
     * gap the server reports is no longer there — must not be asked for again, or
     * the effect and the fetch would drive each other indefinitely.
     */
    const requestPages = useCallback((targetIndex: number, loadedItems: number) => {
        if (!onSeekToIndex) {
            onLoadMore?.();
            return;
        }
        if (seekPendingRef.current || loadedItems <= lastSeekAtRef.current) return;

        lastSeekAtRef.current = loadedItems;
        seekPendingRef.current = true;
        onSeekToIndex(targetIndex)
            .catch(() => {
                // Release the jump: nothing is going to arrive, and holding it
                // would freeze the thumb on a date the grid is not showing.
                if (pendingIndexRef.current === targetIndex) {
                    setPendingIndex(null);
                    resyncThumb();
                }
            })
            .finally(() => {
                seekPendingRef.current = false;
            });
    }, [onSeekToIndex, onLoadMore, setPendingIndex, resyncThumb]);

    /**
     * Resolve a track fraction to a library item and go there. Called
     * synchronously on pointer-down and at most once per frame during a drag
     * (see scheduleDragFrame).
     *
     * `commit` separates *previewing* a position from *committing* to it. A drag
     * crosses hundreds of dates on the way to the one the user wants, and fetching
     * pages for each of them would spend the whole jump loading months nobody
     * asked to see — so only the release (and a plain click, which is a press and
     * release in place) requests data.
     */
    const applyFraction = useCallback((fraction: number, commit: boolean) => {
        const container = containerRef.current;
        if (!container) return;

        const clamped = Math.max(0, Math.min(1, fraction));
        setThumbFraction(clamped);
        if (totalItems <= 0) return;

        const targetIndex = Math.min(totalItems - 1, Math.round(clamped * (totalItems - 1)));
        const scrollTop = scrollTopForItemIndex(rowIndex, targetIndex);

        if (scrollTop === null) {
            /**
             * The target is in a page we have not fetched. Hold it and land on it
             * in the effect below once its page arrives.
             *
             * The viewport stays exactly where it is until then. It used to be
             * parked at the end of the loaded content to keep pages streaming,
             * which is what made a jump to an old month land somewhere else first:
             * with two pages loaded, asking for May 2023 dropped the user at the
             * bottom of page 2 and walked them down through every page in between.
             */
            setPendingIndex(targetIndex);
            commitLabel(findMarkerAtFraction(markers, clamped)?.label ?? null);
            if (commit) requestPages(targetIndex, rowIndex.loadedItems);
            return;
        }

        setPendingIndex(null);
        container.scrollTop = scrollTop;

        const currentDate = findCurrentDateBinary(dateIndex, scrollTop);
        commitLabel(
            currentDate
                ? formatDate(currentDate)
                : (findMarkerAtFraction(markers, clamped)?.label ?? null)
        );
    }, [containerRef, markers, dateIndex, rowIndex, totalItems, requestPages, setPendingIndex, commitLabel]);

    /**
     * Land a jump once the pages holding its target arrive.
     *
     * Re-runs on every new page (`rowIndex` changes). A seek is capped at a batch
     * of pages, so a jump across a large library takes a few passes through here;
     * `requestPages` is idempotent and picks up whatever gap is left.
     */
    useEffect(() => {
        const target = pendingIndexRef.current;
        if (target === null) return;

        // A drag in progress owns the viewport, and its target is still moving.
        // Releasing re-evaluates it, so nothing is lost by sitting this out.
        if (isDraggingRef.current) return;

        const container = containerRef.current;
        if (!container) return;

        const scrollTop = scrollTopForItemIndex(rowIndex, target);
        if (scrollTop !== null) {
            setPendingIndex(null);
            container.scrollTop = scrollTop;
            const currentDate = findCurrentDateBinary(dateIndex, scrollTop);
            if (currentDate) commitLabel(formatDate(currentDate));
            return;
        }

        if (hasMore) {
            requestPages(target, rowIndex.loadedItems);
        }
        else {
            // Ran out of library before reaching the target — settle at the end,
            // which is as near the requested date as the data goes.
            setPendingIndex(null);
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll > 0) container.scrollTop = maxScroll;
        }
    }, [containerRef, rowIndex, dateIndex, hasMore, requestPages, setPendingIndex, commitLabel]);

    // rAF-throttle drag updates: pointermove fires far more often than the
    // display refreshes, so coalesce to at most one scrollTop write per frame.
    const scheduleDragFrame = useCallback((fraction: number) => {
        dragFractionRef.current = fraction;
        if (dragRafRef.current !== null) return;
        dragRafRef.current = requestAnimationFrame(() => {
            dragRafRef.current = null;
            applyFraction(dragFractionRef.current, false);
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
        // Immediate feedback on the initial press, but not a commitment: a click is
        // only what the pointer was over when it came *up*.
        dragFractionRef.current = fraction;
        applyFraction(fraction, false);

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
                // A frame was queued with a fraction not yet applied; pointerup can
                // win that race, and the commit below is the one that counts.
                cancelAnimationFrame(dragRafRef.current);
                dragRafRef.current = null;
            }
            // The release point is the position the user actually chose, so this is
            // where an unloaded target is worth fetching pages for.
            applyFraction(dragFractionRef.current, true);
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

    // A jump in flight keeps the bar up: it is the only thing on screen saying the
    // grid is on its way somewhere, since the viewport itself stays put.
    const isVisible =
        (isHovering || isDragging || isScrolling || isJumping) && canShow && markers.length > 0;

    return {
        isVisible,
        isDragging,
        isJumping,
        thumbFraction,
        activeLabel,
        markers,
        trackRef,
        onTrackPointerDown,
        canShow,
        wrapperHeight,
    };
}
