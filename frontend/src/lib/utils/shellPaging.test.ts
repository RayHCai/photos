import { describe, it, expect } from 'vitest';
import {
    appendShellPages,
    countLoadedItems,
    mapWithConcurrency,
    missingPageOffsets,
} from './shellPaging';

/** A shell page holding `count` items starting at global index `start`. */
function page(start: number, count: number, nextCursor: string | null = `i${start + count - 1}`) {
    return {
        items: Array.from({ length: count }, (_, i) => ({ id: `i${start + i}` })),
        nextCursor,
        hasMore: nextCursor !== null,
    };
}

describe('missingPageOffsets', () => {
    it('asks for nothing when the target is already loaded', () => {
        expect(missingPageOffsets(4000, 0, 2000)).toEqual([]);
        expect(missingPageOffsets(4000, 3999, 2000)).toEqual([]);
    });

    it('asks for one page when the target is inside the next one', () => {
        // 4000 items loaded → the next page covers indices 4000..5999.
        expect(missingPageOffsets(4000, 4000, 2000)).toEqual([4000]);
        expect(missingPageOffsets(4000, 5999, 2000)).toEqual([4000]);
    });

    /**
     * The case the whole change is about: the user picks a month five pages down.
     * These offsets are fetched at once, rather than the gap being walked one
     * `fetchNextPage` round trip at a time with the grid rendering each page.
     */
    it('asks for every page between the loaded range and the target', () => {
        expect(missingPageOffsets(4000, 11000, 2000)).toEqual([4000, 6000, 8000, 10000]);
    });

    it('caps a batch so one click cannot queue an unbounded fan-out', () => {
        const offsets = missingPageOffsets(0, 1_000_000, 2000, 8);

        expect(offsets).toHaveLength(8);
        expect(offsets[0]).toBe(0);
        expect(offsets[7]).toBe(14000);
    });
});

describe('appendShellPages', () => {
    it('appends in order, recording the cursor that would have produced each page', () => {
        const previous = { pages: [page(0, 3)], pageParams: [undefined] as Array<string | undefined> };

        const next = appendShellPages(previous, [
            { offset: 3, page: page(3, 3) },
            { offset: 6, page: page(6, 3) },
        ]);

        expect(next.pages.flatMap((p) => p.items.map((i) => i.id))).toEqual([
            'i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8',
        ]);
        // Each appended page records its predecessor's cursor, so a later refetch
        // of the whole query walks back to exactly this list.
        expect(next.pageParams).toEqual([undefined, 'i2', 'i5']);
    });

    it('leaves the previous pages untouched', () => {
        const previous = { pages: [page(0, 3)], pageParams: [undefined] as Array<string | undefined> };

        appendShellPages(previous, [{ offset: 3, page: page(3, 3) }]);

        expect(previous.pages).toHaveLength(1);
        expect(previous.pageParams).toEqual([undefined]);
    });

    /**
     * The offsets are computed before the fetch, so a page that landed in the
     * meantime — the grid's own scroll lookahead — can already cover part of what
     * comes back. Re-appending it would double every item in that range.
     */
    it('trims a page that overlaps what is already loaded', () => {
        const previous = { pages: [page(0, 5)], pageParams: [undefined] as Array<string | undefined> };

        const next = appendShellPages(previous, [{ offset: 3, page: page(3, 5) }]);

        expect(next.pages[1]?.items.map((i) => i.id)).toEqual(['i5', 'i6', 'i7']);
        expect(countLoadedItems(next.pages)).toBe(8);
    });

    /**
     * An upload between the read of the loaded count and the fetch shifts every
     * offset by one. The grid keys its rows by the first item's id, so a repeated
     * item is a duplicate React key, not just a duplicate tile.
     */
    it('drops items the list already holds', () => {
        const previous = { pages: [page(0, 5)], pageParams: [undefined] as Array<string | undefined> };

        const next = appendShellPages(previous, [
            { offset: 5, page: { ...page(4, 3), items: [{ id: 'i4' }, { id: 'i5' }, { id: 'i6' }] } },
        ]);

        expect(next.pages[1]?.items.map((i) => i.id)).toEqual(['i5', 'i6']);
    });

    /**
     * Every item-index ↔ scroll-offset mapping in the scrollbar assumes the loaded
     * items are the library's first N with nothing missing in between, so a page
     * that would land past the end is dropped rather than appended into a gap.
     */
    it('stops rather than appending past a hole', () => {
        const previous = { pages: [page(0, 5)], pageParams: [undefined] as Array<string | undefined> };

        const next = appendShellPages(previous, [
            { offset: 5, page: page(5, 2) },
            { offset: 7, page: page(7, 2) },
            // A short page above left this one starting past the loaded end.
            { offset: 11, page: page(11, 2) },
        ]);

        expect(next.pages).toHaveLength(3);
        expect(countLoadedItems(next.pages)).toBe(9);
    });

    it('is a no-op when the batch is entirely already loaded', () => {
        const previous = { pages: [page(0, 5)], pageParams: [undefined] as Array<string | undefined> };

        const next = appendShellPages(previous, [{ offset: 0, page: page(0, 5) }]);

        expect(next.pages).toHaveLength(1);
        expect(countLoadedItems(next.pages)).toBe(5);
    });
});

describe('mapWithConcurrency', () => {
    it('returns results in input order regardless of completion order', async () => {
        const delays = [30, 0, 20, 10, 5];

        const results = await mapWithConcurrency(delays, 2, (ms) =>
            new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms))
        );

        expect(results).toEqual(delays);
    });

    it('runs at most `limit` tasks at a time', async () => {
        let active = 0;
        let peak = 0;

        await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
            return null;
        });

        expect(peak).toBe(2);
    });
});
