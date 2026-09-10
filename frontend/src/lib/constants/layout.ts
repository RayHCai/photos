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

/** Gap between cells in the fixed-grid (mobile) layout. */
export const MOBILE_GAP = 2;
/** Horizontal padding of the mobile grid, per side. */
export const MOBILE_PADDING = 4;

/**
 * Extra right-hand inset on mobile, reserved for the timeline scrollbar.
 *
 * There was none. The grid ran to within MOBILE_PADDING of the right edge while the
 * scrollbar's scrub track occupied the 32px immediately inside it, so the track sat
 * entirely on top of the last column — half of a cell at six columns. Every touch aimed
 * at a photo there landed on the scrubber instead, which is why scrolling with a thumb on
 * the right edge did nothing while the rest of the app kept responding.
 *
 * Sized to clear the track (28px) plus a small gap, so the two never intersect.
 */
export const MOBILE_SCROLLBAR_GUTTER = 32;

/** Target row height for the justified layout. */
export const TARGET_ROW_HEIGHT = 220;

/** Height of a sticky date header row. */
export const DATE_HEADER_HEIGHT = 40;

/** Inline style for a desktop row's gap, derived from the same constant as the maths. */
export const desktopGapStyle = { gap: `${DESKTOP_GAP}px` } as const;
export const mobileGapStyle = { gap: `${MOBILE_GAP}px` } as const;
