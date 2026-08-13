/**
 * True on browsers that allow a page only one download it didn't see the user
 * ask for — per page load — and silently drop every later one. That rules out
 * saving a file after any `await`, since the originating tap is long gone by
 * then; the work has to be handed to the browser inside the gesture instead.
 *
 * Deliberately platform-based rather than viewport-based: rotating a phone into
 * landscape can push it past a width breakpoint, and the download policy does
 * not change when it does.
 */
export function blocksAutomaticDownloads(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac, so touch points are what give it away.
    const isIpadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isIpadOS;
}
