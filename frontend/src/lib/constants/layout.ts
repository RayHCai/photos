/**
 * Layout constants shared between the CSS classes, the virtualizer's height math,
 * and the responsive hooks.
 *
 * These were previously duplicated: MOBILE_BREAKPOINT existed in both
 * useIsMobile.ts (measuring window width) and GalleryGrid.tsx (measuring container
 * width), the row gap was a Tailwind class `gap-[5px]` *and* a bare `5` in the
 * layout arithmetic, and the desktop inset was `132` in the maths beside a
 * `px-[66px]` class. Any change to one without the other made the virtualizer's
 * measured row heights disagree with the rendered heights, which shows up as
 * overlapping rows and drifting scroll position.
 */

/** Phone/desktop cut-off, in CSS pixels. */
export const MOBILE_BREAKPOINT = 768;

/** Gap between cells in the justified (desktop) layout. */
export const DESKTOP_GAP = 5;
/** Horizontal inset applied to each desktop row, per side. */
export const DESKTOP_INSET = 66;

/**
 * Gap between cells in the fixed-grid (mobile) layout.
 *
 * There is deliberately no mobile padding or scrollbar gutter any more. The grid runs
 * edge to edge like the phone photo apps, and the timeline scrollbar overlays the last
 * column while it is visible. A gutter used to be reserved because the scrub track was
 * hit-testable along the whole right edge and swallowed swipes aimed at the last column;
 * on touch only the scrollbar's thumb is hit-testable now (see TimelineScrollbar), so
 * the strip no longer needs to be kept clear.
 */
export const MOBILE_GAP = 2;
/** Left inset of a date header on mobile, where the grid itself has none. */
export const MOBILE_HEADER_INSET = 12;

/** Target row height for the justified layout. */
export const TARGET_ROW_HEIGHT = 220;

/** Height of a sticky date header row. */
export const DATE_HEADER_HEIGHT = 40;

/** Inline style for a desktop row's gap, derived from the same constant as the maths. */
export const desktopGapStyle = { gap: `${DESKTOP_GAP}px` } as const;
export const mobileGapStyle = { gap: `${MOBILE_GAP}px` } as const;
