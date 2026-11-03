'use client';

import { useMemo, type RefObject } from 'react';
import { useTimeline } from '@/lib/hooks/useTimeline';
import { useTimelineScrollbar } from '@/lib/hooks/useTimelineScrollbar';
import { computeAdaptiveLabels } from '@/lib/utils/timelineMarkers';
import type { VirtualRow } from './GalleryGrid';

interface TimelineScrollbarProps {
    containerRef: RefObject<HTMLDivElement | null>;
    virtualRows: VirtualRow[];
    timeline?: import('@/lib/types/media').TimelineMonth[];
    /** Whether pages exist beyond the loaded rows. */
    hasMore?: boolean;
    /** Lets a jump to an unloaded month pull the pages it needs. */
    onLoadMore?: () => void;
    /** Global index of the first loaded row; the loaded window's absolute start. */
    windowStart?: number;
    /** Loads the page holding a global item index directly, skipping the rest. */
    onSeekToIndex?: (index: number) => Promise<void>;
    /** Coarse pointer: the thumb is the only hit target, and it is sized for a finger. */
    hasTouch?: boolean;
    /** Height of the empty strip above the first loaded row (see GalleryGrid). */
    leadingSpace: number;
    /** Scrolls so the loaded row at this offset (strip excluded) is at the top. */
    scrollToLocal: (offset: number) => void;
}

/** Width of the strip along the right edge the bar lives in. */
const BAR_WIDTH = 48;
/** Width of the scrub track inside it, hugging the edge. */
const TRACK_WIDTH = 28;
/** Inset of the track from the top and bottom of the container. */
const TRACK_INSET = 16;

export function TimelineScrollbar({
    containerRef,
    virtualRows,
    timeline: timelineProp,
    hasMore,
    onLoadMore,
    windowStart,
    onSeekToIndex,
    hasTouch = false,
    leadingSpace,
    scrollToLocal,
}: TimelineScrollbarProps) {
    // Only fetch the library-wide timeline when this surface has no scoped one of
    // its own. A collection, the hidden view and a public share always pass a
    // `timeline` array (possibly empty while it loads), so `timelineProp` is never
    // undefined for them and the authenticated fetch — which a guest cannot make —
    // stays off.
    const { data: globalTimeline } = useTimeline(timelineProp === undefined);
    const timeline = timelineProp ?? globalTimeline;

    const {
        isVisible,
        isDragging,
        isJumping,
        thumbFraction,
        activeLabel,
        markers,
        trackRef,
        onTrackPointerDown,
        wrapperHeight,
    } = useTimelineScrollbar(containerRef, virtualRows, timeline, {
        hasMore,
        onLoadMore,
        windowStart,
        onSeekToIndex,
        leadingSpace,
        scrollToLocal,
    });

    const visibleLabels = useMemo(
        () => computeAdaptiveLabels(markers, wrapperHeight - TRACK_INSET * 2),
        [markers, wrapperHeight],
    );

    if (wrapperHeight <= 0) return null;

    const trackHeight = wrapperHeight - TRACK_INSET * 2;
    const thumbTop = thumbFraction * trackHeight;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: BAR_WIDTH,
                /**
                 * The wrapper is never hit-testable.
                 *
                 * This element is a *sibling* of the scroll container, not a child, so a
                 * touch that lands on it has no scrollable ancestor and cannot pan the
                 * gallery at all — it is a dead strip, not merely a close one. It used to
                 * become hit-testable whenever the bar was visible, and visibility
                 * includes `isScrolling`, which stays true for 1200ms after the last
                 * scroll event. During ordinary browsing that is continuous, so the right
                 * 48px of the screen — where a one-handed thumb naturally lands —
                 * swallowed swipes for as long as the user kept scrolling.
                 */
                pointerEvents: 'none',
                // Dragging the track must not start a text selection in the gallery
                // behind it; inherited by the labels, thumb and tooltip.
                userSelect: 'none',
                WebkitUserSelect: 'none',
                zIndex: 30,
            }}
            className={`transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        >
            {/* Track */}
            <div
                ref={trackRef}
                onPointerDown={hasTouch ? undefined : onTrackPointerDown}
                style={{
                    position: 'absolute',
                    top: TRACK_INSET,
                    bottom: TRACK_INSET,
                    right: 0,
                    width: TRACK_WIDTH,
                    cursor: 'pointer',
                    touchAction: 'none',
                    /**
                     * With a mouse the whole track is a click target: the cursor was
                     * placed deliberately, so a press anywhere on it jumps there.
                     *
                     * On touch the track is never hit-testable. It runs the full height
                     * of the screen down the edge a one-handed thumb rests on, and since
                     * it now overlays the last column of photos rather than sitting in a
                     * reserved gutter, a track that took touches would swallow every
                     * swipe aimed at that column for as long as the bar was showing.
                     * Only the thumb below takes touches, as in the phone photo apps.
                     */
                    pointerEvents: isVisible && !hasTouch ? 'auto' : 'none',
                }}
            >
                {/* Track line */}
                <div
                    style={{
                        position: 'absolute',
                        right: 5,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        borderRadius: 2,
                    }}
                    className="bg-stone-400/50"
                />

                {/* Month labels */}
                {visibleLabels.map((item) => (
                    <div
                        key={item.label}
                        style={{
                            position: 'absolute',
                            right: 16,
                            top: item.top,
                            transform: 'translateY(-50%)',
                            whiteSpace: 'nowrap',
                        }}
                        className="text-[10px] leading-none text-stone-100 font-sans select-none pointer-events-none bg-black/60 px-1.5 py-1 rounded"
                    >
                        {item.label}
                    </div>
                ))}

                {/*
                  * Thumb, inside a finger-sized hit box. On touch this box is the only
                  * part of the bar that takes a pointer, so it is wider than the track
                  * and reaches a little over the grid — a thumb has to be able to find
                  * it without looking. The drag maths lives in the hook; the box is
                  * marked so a grab on it drags from the thumb's own position rather
                  * than teleporting to the finger.
                  */}
                <div
                    data-timeline-thumb=""
                    onPointerDown={hasTouch ? onTrackPointerDown : undefined}
                    style={{
                        position: 'absolute',
                        right: 0,
                        top: thumbTop,
                        transform: 'translateY(-50%)',
                        width: hasTouch ? 44 : TRACK_WIDTH,
                        height: hasTouch ? 48 : 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: hasTouch ? 3 : 2,
                        touchAction: 'none',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        pointerEvents: isVisible ? 'auto' : 'none',
                    }}
                >
                    <div
                        className="bg-stone-700 shadow-sm"
                        style={
                            hasTouch
                                ? { width: 8, height: 36, borderRadius: 4 }
                                : { width: 10, height: 10, borderRadius: 5 }
                        }
                    />
                </div>
            </div>

            {/*
              * Tooltip — visible while dragging, and while a jump waits on its
              * pages. The grid deliberately does not move until they arrive, so
              * this is what tells the user the date they picked is coming.
              */}
            {(isDragging || isJumping) && activeLabel && (
                <div
                    style={{
                        position: 'absolute',
                        right: hasTouch ? 56 : 52,
                        top: TRACK_INSET + thumbTop,
                        transform: 'translateY(-50%)',
                        whiteSpace: 'nowrap',
                    }}
                    className="bg-stone-800 text-white text-sm px-3 py-1.5 rounded-md font-serif shadow-lg select-none pointer-events-none"
                >
                    {activeLabel}
                </div>
            )}
        </div>
    );
}
