import { useRef, useEffect, type RefObject } from 'react';

interface UseSwipeNavigationOptions {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    threshold?: number;
}

export function useSwipeNavigation<T extends HTMLElement>(
    ref: RefObject<T | null>,
    { onSwipeLeft, onSwipeRight, threshold = 50 }: UseSwipeNavigationOptions
) {
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const swiped = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        function handleTouchStart(e: TouchEvent) {
            if (e.touches.length !== 1) return;
            touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            swiped.current = false;
        }

        function handleTouchMove(e: TouchEvent) {
            if (!touchStart.current || e.touches.length !== 1 || swiped.current) return;

            const dx = e.touches[0].clientX - touchStart.current.x;
            const dy = e.touches[0].clientY - touchStart.current.y;

            // Only trigger if horizontal movement is dominant
            if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;

            swiped.current = true;
            if (dx < 0) {
                onSwipeLeft?.();
            } else {
                onSwipeRight?.();
            }
        }

        function handleTouchEnd() {
            touchStart.current = null;
        }

        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchmove', handleTouchMove, { passive: true });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [ref, onSwipeLeft, onSwipeRight, threshold]);
}
