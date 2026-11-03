import { describe, it, expect } from 'vitest';
import { computeWindowShift, estimateLeadingSpace } from './scrollAnchor';

/** Rows named by key, every one 100px tall unless given. */
function rows(keys: string[], height = 100) {
    return keys.map((key) => ({ key, height }));
}

const atStart = { atLibraryStart: false };

describe('computeWindowShift', () => {
    it('absorbs an eviction above the viewport into the leading space without moving scrollTop', () => {
        const prev = rows(['a', 'b', 'c', 'd', 'e', 'f']);
        const next = rows(['c', 'd', 'e', 'f']); // a, b evicted (200px)

        const shift = computeWindowShift(prev, next, 350, 0, atStart);

        expect(shift.anchored).toBe(true);
        expect(shift.leadingSpace).toBe(200);
        expect(shift.scrollTop).toBe(350);
    });

    it('shrinks the leading space when the evicted rows come back', () => {
        const prev = rows(['c', 'd', 'e', 'f']);
        const next = rows(['a', 'b', 'c', 'd', 'e', 'f']);

        const shift = computeWindowShift(prev, next, 350, 200, atStart);

        expect(shift.leadingSpace).toBe(0);
        expect(shift.scrollTop).toBe(350);
    });

    it('falls back to a scrollTop write when a prepend is larger than the strip', () => {
        const prev = rows(['c', 'd', 'e', 'f']);
        const next = rows(['a', 'b', 'c', 'd', 'e', 'f']);

        // Only 50px of strip for 200px of new rows: the other 150 must move scrollTop.
        const shift = computeWindowShift(prev, next, 350, 50, atStart);

        expect(shift.leadingSpace).toBe(0);
        expect(shift.scrollTop).toBe(500);
    });

    it('anchors to the row straddling the top edge even when rows above it re-chunked', () => {
        // The straddling day re-chunks: 'b' is gone, 'c' survives with a new offset.
        const prev = rows(['a', 'b', 'c', 'd']);
        const next = rows(['x', 'c', 'd']); // 'x' replaces 'a'+'b' (one row of 100 instead of 200)

        // Top edge at 250 sits inside 'c' (200..300). 'c' moved from 200 to 100.
        const shift = computeWindowShift(prev, next, 250, 0, atStart);

        expect(shift.leadingSpace).toBe(100);
        expect(shift.scrollTop).toBe(250);
    });

    it('reports no anchor when the whole window was replaced', () => {
        const shift = computeWindowShift(rows(['a', 'b']), rows(['p', 'q']), 50, 120, atStart);

        expect(shift.anchored).toBe(false);
        expect(shift.leadingSpace).toBe(120);
        expect(shift.scrollTop).toBe(50);
    });

    it('leaves a viewport pinned to the very top alone so new uploads appear above it', () => {
        const prev = rows(['b', 'c']);
        const next = rows(['a', 'b', 'c']);

        const shift = computeWindowShift(prev, next, 0, 0, atStart);

        expect(shift).toEqual({ leadingSpace: 0, scrollTop: 0, anchored: true });
    });

    it('still anchors at scrollTop 0 when a strip exists (the user outran the prepend)', () => {
        const prev = rows(['c', 'd']);
        const next = rows(['a', 'b', 'c', 'd']);

        const shift = computeWindowShift(prev, next, 0, 200, atStart);

        expect(shift.leadingSpace).toBe(0);
        expect(shift.scrollTop).toBe(0);
    });

    it('collapses the strip at the library start and moves scrollTop by the same amount', () => {
        const prev = rows(['c', 'd', 'e']);
        const next = rows(['a', 'b', 'c', 'd', 'e']);

        // An over-estimated strip of 260 for 200px of rows: 60 would be left over.
        const shift = computeWindowShift(prev, next, 400, 260, { atLibraryStart: true });

        expect(shift.leadingSpace).toBe(0);
        expect(shift.scrollTop).toBe(340);
    });

    it('never produces a negative scrollTop', () => {
        const prev = rows(['c']);
        const next = rows(['a', 'b', 'c']);

        const shift = computeWindowShift(prev, next, 10, 500, { atLibraryStart: true });

        expect(shift.leadingSpace).toBe(0);
        expect(shift.scrollTop).toBe(0);
    });
});

describe('estimateLeadingSpace', () => {
    it('is the row count above the window times the row height', () => {
        expect(estimateLeadingSpace(900, 3, 130)).toBe(300 * 130);
        expect(estimateLeadingSpace(901, 3, 130)).toBe(301 * 130);
    });

    it('is zero at the library start or with degenerate inputs', () => {
        expect(estimateLeadingSpace(0, 3, 130)).toBe(0);
        expect(estimateLeadingSpace(900, 0, 130)).toBe(0);
        expect(estimateLeadingSpace(900, 3, 0)).toBe(0);
    });
});
