/**
 * Page arithmetic for jumping the paginated gallery to an arbitrary item index.
 *
 * The timeline scrollbar addresses the *whole* library (month counts from
 * `/media/timeline`), while the grid only holds the pages fetched so far. A jump
 * to a month below the loaded range therefore has to bring pages in before it can
 * land. It used to do that one page per round trip, driven by `fetchNextPage`, and
 * parked the viewport at the end of the loaded content while it waited — so the
 * user saw the grid stop somewhere they had not asked for, scroll through each
 * intervening page, and only then arrive.
 *
 * The gap is now fetched by offset, several pages at a time, and the viewport does
 * not move until the target row exists. These helpers are the pure part of that:
 * which offsets are missing, and how a fetched batch merges into the cached pages.
 */

/**
 * Requested explicitly on every shell request rather than left to the server
 * default, because offsets are only exact if every page holds the same count.
 * The server caps at this value (`SHELL_PAGE_SIZE` in media.service.ts).
 */
export const SHELL_PAGE_SIZE = 2000;

/**
 * Pages one seek pulls before handing control back to React.
 *
 * A jump across a 100k library spans far more than this. Fetching it as several
 * bounded batches renders what has arrived between them — so the "jumping" state
 * visibly progresses — and keeps one mis-aimed click from queueing fifty requests.
 */
export const MAX_PAGES_PER_SEEK = 8;

/** In-flight shell requests per seek. Each one is a `skip`-heavy query. */
export const SEEK_CONCURRENCY = 4;

/**
 * Offsets of the pages still needed for `targetIndex` to be loaded, in order,
 * capped at `maxPages`. Empty when the target is already loaded.
 *
 * `loadedItems` is the count of contiguously loaded items — which is also the
 * global offset of the first item not yet held, since pages run from index 0.
 */
export function missingPageOffsets(
    loadedItems: number,
    targetIndex: number,
    pageSize: number = SHELL_PAGE_SIZE,
    maxPages: number = MAX_PAGES_PER_SEEK
): number[] {
    if (targetIndex < loadedItems || pageSize <= 0) return [];

    const needed = Math.ceil((targetIndex + 1 - loadedItems) / pageSize);
    const offsets: number[] = [];
    for (let i = 0; i < Math.min(needed, maxPages); i++) {
        offsets.push(loadedItems + i * pageSize);
    }
    return offsets;
}

interface PageLike {
    items: Array<{ id: string }>;
    nextCursor: string | null;
}

interface InfinitePages<P> {
    pages: P[];
    pageParams: Array<string | undefined>;
}

/** Items held across all loaded pages. */
export function countLoadedItems(pages: Array<{ items: unknown[] }>): number {
    let total = 0;
    for (const page of pages) total += page.items.length;
    return total;
}

/**
 * Merge offset-fetched pages onto the end of the cached ones.
 *
 * Three things have to hold afterwards, and each is a rule below:
 *
 * - **No holes.** Every item-index ↔ scroll-offset mapping in the scrollbar
 *   assumes the loaded items are the library's first N. A page landing past the
 *   end of what is loaded is dropped rather than appended into a gap.
 * - **No duplicates.** An insert between the read of `loadedItems` and the fetch
 *   shifts every offset by one, which would re-add rows the list already holds —
 *   and the grid keys rows by their first item's id.
 * - **Replayable page params.** Each appended page records the cursor that would
 *   have produced it had the list been walked to, so React Query refetching the
 *   whole query reproduces the same list.
 */
export function appendShellPages<P extends PageLike>(
    previous: InfinitePages<P>,
    fetched: Array<{ offset: number; page: P }>
): InfinitePages<P> {
    const pages = [...previous.pages];
    const pageParams = [...previous.pageParams];

    let loaded = countLoadedItems(pages);

    // Only the join needs guarding: a shift large enough to reach further back
    // than the last page would mean the library changed out from under a jump by
    // more than a page, which the next refetch resolves anyway.
    const seen = new Set<string>();
    for (const item of pages[pages.length - 1]?.items ?? []) seen.add(item.id);

    for (const { offset, page } of fetched) {
        if (offset > loaded) break;

        const overlap = loaded - offset;
        const fresh = (overlap > 0 ? page.items.slice(overlap) : page.items).filter(
            (item) => !seen.has(item.id)
        );
        if (fresh.length === 0) continue;
        for (const item of fresh) seen.add(item.id);

        pageParams.push(pages[pages.length - 1]?.nextCursor ?? undefined);
        // The spread widens `items` past P's own element type; the runtime shape is
        // the page the server returned, minus rows the list already holds.
        pages.push({ ...page, items: fresh } as P);
        loaded += fresh.length;
    }

    return { pages, pageParams };
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
