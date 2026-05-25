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
}

export function TimelineScrollbar({ containerRef, virtualRows, timeline: timelineProp }: TimelineScrollbarProps) {
    const { data: globalTimeline } = useTimeline();
    const timeline = timelineProp ?? globalTimeline;

    const {
        isVisible,
        isDragging,
        thumbFraction,
        activeLabel,
        markers,
        trackRef,
        onTrackPointerDown,
        wrapperHeight,
    } = useTimelineScrollbar(containerRef, virtualRows, timeline);

    const visibleLabels = useMemo(
        () => computeAdaptiveLabels(markers, wrapperHeight - 32),
        [markers, wrapperHeight],
    );

    if (wrapperHeight <= 0) return null;

    const trackHeight = wrapperHeight - 32;
    const thumbTop = thumbFraction * trackHeight;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: 48,
                pointerEvents: isVisible ? 'auto' : 'none',
                zIndex: 30,
            }}
            className={`transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        >
            {/* Track */}
            <div
                ref={trackRef}
                onPointerDown={onTrackPointerDown}
                style={{
                    position: 'absolute',
                    top: 16,
                    bottom: 16,
                    right: 8,
                    width: 32,
                    cursor: 'pointer',
                    touchAction: 'none',
                }}
            >
                {/* Track line */}
                <div
                    style={{
                        position: 'absolute',
                        right: 4,
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
                            right: 14,
                            top: item.top,
                            transform: 'translateY(-50%)',
                            whiteSpace: 'nowrap',
                        }}
                        className="text-[10px] leading-none text-stone-100 font-sans select-none pointer-events-none bg-black/60 px-1.5 py-1 rounded"
                    >
                        {item.label}
                    </div>
                ))}

                {/* Thumb */}
                <div
                    style={{
                        position: 'absolute',
                        right: 1,
                        top: thumbTop,
                        transform: 'translateY(-50%)',
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                    }}
                    className="bg-stone-700 shadow-sm"
                />
            </div>

            {/* Tooltip (visible while dragging) */}
            {isDragging && activeLabel && (
                <div
                    style={{
                        position: 'absolute',
                        right: 52,
                        top: 16 + thumbTop,
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
