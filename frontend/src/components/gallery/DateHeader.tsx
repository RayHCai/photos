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
            className="py-2 sticky top-0 z-10 bg-stone-50/90 backdrop-blur-sm text-left"
            style={contentOffset ? { paddingLeft: Math.max(0, contentOffset - 4) } : undefined}
        >
            <h2 className="text-sm font-serif text-stone-700">{label}</h2>
        </div>
    );
});
