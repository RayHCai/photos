'use client';

import { useEffect, useRef } from 'react';

export function useInfiniteScroll(
    onIntersect: () => void,
    enabled: boolean = true
) {
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!enabled) return;

        const el = sentinelRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    onIntersect();
                }
            },
            { rootMargin: '400px' }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [onIntersect, enabled]);

    return sentinelRef;
}
