'use client';

import { useState, useEffect } from 'react';
import { MOBILE_BREAKPOINT } from '../constants/layout';

/**
 * Whether the viewport is phone-sized.
 *
 * Two things were wrong before. It initialised to `false` and only corrected after
 * mount, so every phone rendered one frame of the desktop layout before flipping —
 * a visible flash, and one frame with the wrong handlers attached wherever binding
 * was conditional. And it measured `window.innerWidth` while GalleryGrid measured
 * its own *container* width against a separate copy of the same 768 constant, so
 * the two disagreed whenever a sidebar was present: an 800px window yields a ~700px
 * container, and the app simultaneously believed it was and was not mobile.
 *
 * Both now read one breakpoint from constants/layout, and this hook uses a media
 * query so the value is correct in the same commit as mount.
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState<boolean | null>(null);

    useEffect(() => {
        const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const update = () => setIsMobile(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    // There is no viewport to measure on the server or in the first render pass.
    // Reporting false matches the SSR markup so hydration stays consistent.
    return isMobile ?? false;
}

/**
 * Whether the primary pointer is coarse (finger or stylus), independent of size.
 *
 * Size and input capability are different questions, and conflating them is why
 * iPads and touch laptops got desktop-only interaction: they are wide, so
 * `useIsMobile` was false, so the touch gestures were never enabled at all.
 */
export function useHasTouch(): boolean {
    const [hasTouch, setHasTouch] = useState(false);

    useEffect(() => {
        const query = window.matchMedia('(pointer: coarse)');
        const update = () => setHasTouch(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    return hasTouch;
}
