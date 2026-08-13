'use client';

import { memo } from 'react';

export const DateHeader = memo(function DateHeader({
    label,
    contentOffset,
}: {
    label: string;
    contentOffset?: number;
}) {
    return (
        <div
            /**
             * Not `sticky`. Each virtual row is an absolutely-positioned box of
             * exactly this header's height carrying a transform and
             * `contain: layout style paint`, so a sticky element had zero sliding
             * range inside its containing block and was clipped besides — the
             * declaration was completely inert. The active group's label is shown by
             * the timeline overlay instead (see TimelineScrollbar).
             */
            className="py-2 bg-stone-50/90 text-left"
            style={contentOffset ? { paddingLeft: Math.max(0, contentOffset - 4) } : { paddingLeft: 4 }}
        >
            <h2 className="text-sm font-serif text-stone-700">{label}</h2>
        </div>
    );
});
