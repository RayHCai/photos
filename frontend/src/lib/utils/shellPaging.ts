/**
 * Page arithmetic for the windowed gallery.
 *
 * The gallery holds a *sliding window* of pages around the scroll position, not a
 * prefix growing from the top. React Query's `maxPages` caps how many pages are
 * retained and drops the far one as you scroll; these helpers cover the two things
 * it does not: what page size the window tiles at, and — for a timeline jump that
 * lands outside the window — which offsets to fetch to rebuild the window around a
 * target item index.
 *
 * Everything here is addressed by *offset* (a plain item index), because the window
 * can start anywhere: a jump to an old month makes "loaded" a middle slab, not the
 * library's first N. Offsets are multiples of `SHELL_PAGE_SIZE`, so pages tile
 * without gaps or overlap.
 */

/**
 * Items per page. Small on purpose: the whole window (`WINDOW_PAGES` of these) is
 * re-grouped and re-laid-out on every append, and every derived structure
 * (groups, the id→index map, the justified layout) is held for the window. A large
 * page made each of those O(page) allocations dwarf a screenful. The server caps
 * at 2000 (`SHELL_PAGE_SIZE` in media.service.ts); anything at or under that is
 * honored verbatim.
 */
export const SHELL_PAGE_SIZE = 300;

/**
 * Pages retained at once — the window size, in pages. Passed to React Query's
 * `maxPages`. Must be large enough to cover a viewport plus the scroll lookahead
 * on both edges so the window is not refetched under the user mid-scroll, and
 * small enough that the retained item count (`WINDOW_PAGES * SHELL_PAGE_SIZE`)
 * stays bounded regardless of how far the library is scrolled.
 */
export const WINDOW_PAGES = 5;

/** In-flight shell requests per seek when rebuilding the window. */
export const SEEK_CONCURRENCY = 4;

/**
 * Offsets of the pages a jump to `targetIndex` should load, so the target lands
 * inside the window rather than at its very edge (one page of lead above it when
 * the library allows). Always returns `WINDOW_PAGES` offsets; offsets past the end
 * of the library come back as empty pages and are dropped by the caller.
 */
export function seekWindowOffsets(
    targetIndex: number,
    pageSize: number = SHELL_PAGE_SIZE,
    windowPages: number = WINDOW_PAGES,
): number[] {
    if (targetIndex < 0 || pageSize <= 0 || windowPages <= 0) return [];

    const targetPage = Math.floor(targetIndex / pageSize);
    // Keep one page above the target so scrolling back up a little does not
    // immediately fall out of the window — but never below page 0.
    const lead = Math.min(1, windowPages - 1);
    const startPage = Math.max(0, targetPage - lead);

    const offsets: number[] = [];
    for (let i = 0; i < windowPages; i++) offsets.push((startPage + i) * pageSize);
    return offsets;
}

/** Items held across all loaded pages. */
export function countLoadedItems(pages: Array<{ items: unknown[] }>): number {
    let total = 0;
    for (const page of pages) total += page.items.length;
    return total;
}

/** Run `fn` over `items`, at most `limit` at a time, preserving result order. */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (let i = next++; i < items.length; i = next++) {
            results[i] = await fn(items[i]!);
        }
    });

    await Promise.all(workers);
    return results;
}
