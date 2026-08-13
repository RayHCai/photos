import { describe, expect, it } from 'vitest';
import { dayKeyOf, groupByDate } from './groupByDate';
import type { MediaShellItem } from '../types/media';

function item(overrides: Partial<MediaShellItem> & { id: string }): MediaShellItem {
    return {
        type: 'PHOTO',
        thumbnailKey: null,
        blurHash: null,
        width: 100,
        height: 100,
        durationSeconds: null,
        takenAt: null,
        takenAtLocal: null,
        processingStatus: 'COMPLETED',
        createdAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

/**
 * The bug this guards: grouping keyed off `takenAt`, the UTC instant, so a photo shot
 * near midnight local time landed on a different day for the viewer than the one the
 * camera recorded. `takenAtLocal` is the camera's wall clock and is stable regardless of
 * who is looking.
 */
describe('dayKeyOf', () => {
    it('prefers the capture-local wall clock', () => {
        expect(
            dayKeyOf(
                item({
                    id: 'a',
                    takenAtLocal: '2024-06-15T23:30:00.000',
                    // Same instant expressed in UTC is the *next* day.
                    takenAt: '2024-06-16T04:30:00.000Z',
                })
            )
        ).toBe('2024-06-15');
    });

    it('falls back to takenAt when no local value exists', () => {
        expect(dayKeyOf(item({ id: 'a', takenAt: '2024-06-16T04:30:00.000Z' }))).toBe(
            '2024-06-16'
        );
    });

    it('falls back to createdAt when the item has no capture time at all', () => {
        // A file whose EXIF was stripped. It must land on its upload date, and must land
        // on the *same* date everywhere — search used to fabricate `new Date()` here,
        // filing it under "Today" in results but under its real date in the timeline.
        expect(dayKeyOf(item({ id: 'a', createdAt: '2023-11-02T08:00:00.000Z' }))).toBe(
            '2023-11-02'
        );
    });

    /**
     * The key is a slice of the ISO string, not a date-fns format call. That call
     * allocated a Date and ran token parsing *per photo* — several hundred ms of
     * unbreakable main-thread work for a 20k library, on a path that ran twice per
     * change and again on every pinch frame.
     */
    it('is a plain ISO date prefix', () => {
        expect(dayKeyOf(item({ id: 'a', takenAtLocal: '2024-02-29T12:00:00.000' }))).toBe(
            '2024-02-29'
        );
    });
});

describe('groupByDate', () => {
    it('groups items sharing a local day', () => {
        const groups = groupByDate([
            item({ id: 'a', takenAtLocal: '2024-06-15T09:00:00.000' }),
            item({ id: 'b', takenAtLocal: '2024-06-15T21:00:00.000' }),
            item({ id: 'c', takenAtLocal: '2024-06-14T10:00:00.000' }),
        ]);

        expect(groups).toHaveLength(2);
        expect(groups[0]!.date).toBe('2024-06-15');
        expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
        expect(groups[1]!.date).toBe('2024-06-14');
    });

    it('orders groups newest first', () => {
        const groups = groupByDate([
            item({ id: 'old', takenAtLocal: '2020-01-01T00:00:00.000' }),
            item({ id: 'new', takenAtLocal: '2024-01-01T00:00:00.000' }),
            item({ id: 'mid', takenAtLocal: '2022-01-01T00:00:00.000' }),
        ]);

        expect(groups.map((g) => g.items[0]!.id)).toEqual(['new', 'mid', 'old']);
    });

    it('preserves input order inside a group', () => {
        // The grid's visual order and the lightbox's navigation order are both derived
        // from this, so a reordering here would desynchronise them.
        const groups = groupByDate([
            item({ id: 'first', takenAtLocal: '2024-06-15T09:00:00.000' }),
            item({ id: 'second', takenAtLocal: '2024-06-15T08:00:00.000' }),
        ]);

        expect(groups[0]!.items.map((i) => i.id)).toEqual(['first', 'second']);
    });

    it('does not split a day across two groups', () => {
        const groups = groupByDate([
            item({ id: 'a', takenAtLocal: '2024-06-15T09:00:00.000' }),
            item({ id: 'b', takenAtLocal: '2024-06-14T09:00:00.000' }),
            item({ id: 'c', takenAtLocal: '2024-06-15T10:00:00.000' }),
        ]);

        expect(groups.filter((g) => g.date === '2024-06-15')).toHaveLength(1);
    });

    it('returns nothing for an empty list', () => {
        expect(groupByDate([])).toEqual([]);
    });

    it('gives every group a label', () => {
        const groups = groupByDate([item({ id: 'a', takenAtLocal: '2020-06-15T09:00:00.000' })]);
        expect(groups[0]!.label).toBeTruthy();
    });
});
