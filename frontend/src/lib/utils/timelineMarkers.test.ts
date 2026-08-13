import { describe, it, expect } from 'vitest';
import {
    buildRowItemIndex,
    itemIndexAtScrollTop,
    scrollTopForItemIndex,
    totalItemsInTimeline,
} from './timelineMarkers';

/**
 * The row shape the grid feeds the scrollbar: a date header opening each day,
 * then gallery rows carrying the items.
 */
function rows(spec: Array<number | 'header'>) {
    return spec.map((s) =>
        s === 'header'
            ? { type: 'date-header' as const, height: 40 }
            : {
                type: 'gallery-row' as const,
                height: 200,
                rowData: { row: { items: Array.from({ length: s }, (_, i) => ({ id: `i${i}` })) } },
            }
    );
}

describe('buildRowItemIndex', () => {
    it('counts only the items in gallery rows, and every row towards height', () => {
        const index = buildRowItemIndex(rows(['header', 4, 3, 'header', 5]));

        expect(index.loadedItems).toBe(12);
        expect(index.totalHeight).toBe(40 + 200 + 200 + 40 + 200);
    });

    it('is empty for an empty grid', () => {
        const index = buildRowItemIndex([]);

        expect(index.loadedItems).toBe(0);
        expect(index.totalHeight).toBe(0);
        expect(scrollTopForItemIndex(index, 0)).toBeNull();
    });
});

describe('scrollTopForItemIndex', () => {
    const index = buildRowItemIndex(rows(['header', 4, 3, 'header', 5]));

    it('lands on the date header when the item opens a day', () => {
        // Item 0 opens day one (header at 0); item 7 opens day two (header at 440).
        expect(scrollTopForItemIndex(index, 0)).toBe(0);
        expect(scrollTopForItemIndex(index, 7)).toBe(440);
    });

    it('lands on the item\'s own row mid-day', () => {
        expect(scrollTopForItemIndex(index, 5)).toBe(240);  // second row of day one
        expect(scrollTopForItemIndex(index, 9)).toBe(480);  // day two's only row
    });

    /**
     * The case the paginated gallery turns on: a jump targets an item whose page
     * has not been fetched. Returning null is what tells the scrollbar to pull
     * pages rather than scroll somewhere wrong — mapping the target onto the
     * loaded scroll height instead is precisely the bug that made every jump past
     * the first page land back in the newest photos.
     */
    it('reports an unloaded item rather than guessing a position', () => {
        expect(scrollTopForItemIndex(index, 12)).toBeNull();
        expect(scrollTopForItemIndex(index, 5000)).toBeNull();
    });

    it('rejects a negative index', () => {
        expect(scrollTopForItemIndex(index, -1)).toBeNull();
    });
});

describe('itemIndexAtScrollTop', () => {
    const index = buildRowItemIndex(rows(['header', 4, 3, 'header', 5]));

    it('maps a scroll offset back to the first item on screen', () => {
        expect(itemIndexAtScrollTop(index, 0)).toBe(0);   // header of day one
        expect(itemIndexAtScrollTop(index, 40)).toBe(0);
        expect(itemIndexAtScrollTop(index, 250)).toBe(4); // into the second row
        expect(itemIndexAtScrollTop(index, 450)).toBe(7); // past the second header
    });

    it('round-trips with scrollTopForItemIndex for mid-day items', () => {
        for (const item of [0, 4, 5, 8, 11]) {
            const top = scrollTopForItemIndex(index, item);
            expect(top).not.toBeNull();
            // Landing scrolls to the item's row, so the first item of that row is
            // at the top — never past the item the user asked for.
            expect(itemIndexAtScrollTop(index, top!)).toBeLessThanOrEqual(item);
        }
    });

    it('clamps past the end of the content', () => {
        expect(itemIndexAtScrollTop(index, 99999)).toBe(7);
    });
});

describe('totalItemsInTimeline', () => {
    it('sums the month counts', () => {
        expect(totalItemsInTimeline([
            { month: '2026-08', count: 150 },
            { month: '2026-07', count: 2372 },
        ])).toBe(2522);
    });

    it('treats a missing timeline as unknown rather than as zero photos', () => {
        expect(totalItemsInTimeline(undefined)).toBe(0);
        expect(totalItemsInTimeline([])).toBe(0);
    });
});
