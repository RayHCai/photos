import { useRef, useEffect, type RefObject } from 'react';

interface UseSwipeNavigationOptions {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeUp?: () => void;
    threshold?: number;
    /** When true, all swipe gestures are ignored (e.g. while image is zoomed). */
    disabled?: boolean;
}

/**
 * Native gallery-style swipe navigation.
 * Directly manipulates the track element's transform for 60fps performance.
 * The track must be a 3-panel carousel (width: 300%) with default
 * transform: translateX(-33.333%) to center on the middle panel.
 */
export function useSwipeNavigation(
    trackRef: RefObject<HTMLElement | null>,
    { onSwipeLeft, onSwipeRight, onSwipeUp, threshold = 0.25, disabled = false }: UseSwipeNavigationOptions
) {
    const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, onSwipeUp });
    callbacksRef.current = { onSwipeLeft, onSwipeRight, onSwipeUp };
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return;

        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let direction: 'h' | 'v' | null = null;
        let currentOffset = 0;
        let animating = false;

        function setTransform(offsetPx: number, animate: boolean) {
            track!.style.transition = animate
                ? 'transform 300ms cubic-bezier(0.2, 0, 0, 1)'
                : 'none';
            track!.style.transform = `translateX(calc(-33.333% + ${offsetPx}px))`;
        }

        function setVerticalTransform(offsetPy: number, animate: boolean) {
            track!.style.transition = animate
                ? 'transform 300ms cubic-bezier(0.2, 0, 0, 1), opacity 300ms ease'
                : 'none';
            track!.style.transform = `translateX(-33.333%) translateY(${offsetPy}px)`;
            const progress = Math.min(Math.abs(offsetPy) / 300, 1);
            track!.style.opacity = `${1 - progress * 0.5}`;
        }

        function handleTouchStart(e: TouchEvent) {
            if (e.touches.length !== 1 || animating || disabledRef.current) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startTime = Date.now();
            direction = null;
            currentOffset = 0;
            track!.style.opacity = '1';
            setTransform(0, false);
        }

        function handleTouchMove(e: TouchEvent) {
            if (e.touches.length !== 1 || animating || startTime === 0) return;

            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;

            // Lock direction after 8px of movement
            if (!direction) {
                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                    direction = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
                }
            }
            // Vertical swipe down to dismiss
            if (direction === 'v') {
                const { onSwipeUp: up } = callbacksRef.current;
                if (!up || dy < 0) return;
                e.preventDefault();
                currentOffset = dy;
                setVerticalTransform(dy, false);
                return;
            }

            if (direction !== 'h') return;

            e.preventDefault();

            let offset = dx;
            const { onSwipeLeft: left, onSwipeRight: right } = callbacksRef.current;

            // Rubber-band effect at edges (no prev/next available)
            if ((offset > 0 && !right) || (offset < 0 && !left)) {
                offset *= 0.2;
            }

            currentOffset = offset;
            setTransform(offset, false);
        }

        function handleTouchEnd() {
            // Vertical swipe up to dismiss
            if (direction === 'v') {
                const { onSwipeUp: up } = callbacksRef.current;
                if (up && currentOffset > 0) {
                    const elapsed = Date.now() - startTime;
                    const velocity = Math.abs(currentOffset) / Math.max(elapsed, 1);
                    const containerH = track!.parentElement?.clientHeight ?? window.innerHeight;
                    const pastThreshold = Math.abs(currentOffset) > containerH * threshold;
                    const isFlick = velocity > 0.4 && Math.abs(currentOffset) > 30;

                    animating = true;
                    if (pastThreshold || isFlick) {
                        setVerticalTransform(containerH, true);
                        setTimeout(() => {
                            up();
                            animating = false;
                            track!.style.opacity = '1';
                            setTransform(0, false);
                        }, 300);
                    }
                    else {
                        setVerticalTransform(0, true);
                        setTimeout(() => {
                            track!.style.opacity = '1';
                            animating = false;
                        }, 300);
                    }
                }
                direction = null;
                startTime = 0;
                currentOffset = 0;
                return;
            }

            if (direction !== 'h' || animating) {
                direction = null;
                startTime = 0;
                return;
            }

            const elapsed = Date.now() - startTime;
            const velocity = Math.abs(currentOffset) / Math.max(elapsed, 1);
            const containerW = track!.parentElement?.clientWidth ?? window.innerWidth;
            const pastThreshold = Math.abs(currentOffset) > containerW * threshold;
            const isFlick = velocity > 0.4 && Math.abs(currentOffset) > 30;
            const { onSwipeLeft: left, onSwipeRight: right } = callbacksRef.current;

            direction = null;
            startTime = 0;
            animating = true;

            if ((pastThreshold || isFlick) && currentOffset < 0 && left) {
                // Slide out to show next
                setTransform(-containerW, true);
                setTimeout(() => {
                    left();
                    animating = false;
                    setTransform(0, false);
                }, 300);
            }
            else if ((pastThreshold || isFlick) && currentOffset > 0 && right) {
                // Slide out to show prev
                setTransform(containerW, true);
                setTimeout(() => {
                    right();
                    animating = false;
                    setTransform(0, false);
                }, 300);
            }
            else {
                // Spring back to center
                setTransform(0, true);
                setTimeout(() => {
                    animating = false;
                }, 300);
            }

            currentOffset = 0;
        }

        function handleTouchCancel() {
            direction = null;
            startTime = 0;
            currentOffset = 0;
            animating = true;
            track!.style.opacity = '1';
            setTransform(0, true);
            setTimeout(() => {
                animating = false;
            }, 300);
        }

        track.addEventListener('touchstart', handleTouchStart, { passive: true });
        track.addEventListener('touchmove', handleTouchMove, { passive: false });
        track.addEventListener('touchend', handleTouchEnd, { passive: true });
        track.addEventListener('touchcancel', handleTouchCancel, { passive: true });

        return () => {
            track.removeEventListener('touchstart', handleTouchStart);
            track.removeEventListener('touchmove', handleTouchMove);
            track.removeEventListener('touchend', handleTouchEnd);
            track.removeEventListener('touchcancel', handleTouchCancel);
        };
    }, [trackRef, threshold]);
}
