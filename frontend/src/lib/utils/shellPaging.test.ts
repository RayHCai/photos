import { describe, it, expect } from 'vitest';
import { countLoadedItems, mapWithConcurrency, seekWindowOffsets } from './shellPaging';

describe('seekWindowOffsets', () => {
    it('keeps one page of lead above the target when the library allows', () => {
        // target 5000, page 300 → target page 16 (offset 4800); lead one page.
        expect(seekWindowOffsets(5000, 300, 5)).toEqual([4500, 4800, 5100, 5400, 5700]);
    });

    it('clamps the window start at page 0 near the top', () => {
        expect(seekWindowOffsets(100, 300, 5)).toEqual([0, 300, 600, 900, 1200]);
        expect(seekWindowOffsets(0, 300, 5)).toEqual([0, 300, 600, 900, 1200]);
    });

    it('always returns exactly windowPages offsets (trailing ones may be past the end)', () => {
        expect(seekWindowOffsets(9_000_000, 300, 3)).toHaveLength(3);
    });

    it('returns nothing for a nonsensical request', () => {
        expect(seekWindowOffsets(-1)).toEqual([]);
        expect(seekWindowOffsets(100, 0)).toEqual([]);
    });
});

describe('countLoadedItems', () => {
    it('sums items across pages', () => {
        expect(
            countLoadedItems([{ items: [1, 2, 3] }, { items: [] }, { items: [4, 5] }]),
        ).toBe(5);
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
