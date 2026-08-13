import { formatDate } from './format';
import type { MediaShellItem } from '../types/media';

export interface DateGroup<T extends MediaShellItem = MediaShellItem> {
    date: string;
    label: string;
    items: T[];
}

/**
 * The day key for an item, as a plain `YYYY-MM-DD` string.
 *
 * Two things were wrong before. It used `format(new Date(dateStr), 'yyyy-MM-dd')`,
 * allocating a Date and running date-fns token parsing **per photo** to produce a
 * value that is already a prefix of the ISO string — several hundred ms of
 * unbreakable main-thread work for a 20k library, on a path that ran twice per
 * change and again on every pinch frame. And it keyed off `takenAt`, the UTC
 * instant, so a photo shot near midnight local time landed on the wrong day for the
 * viewer; `takenAtLocal` is the camera's wall clock and is stable regardless of who
 * is looking.
 */
export function dayKeyOf(item: MediaShellItem): string {
    const stamp = item.takenAtLocal ?? item.takenAt ?? item.createdAt;
    return stamp.slice(0, 10);
}

export function groupByDate<T extends MediaShellItem>(items: T[]): DateGroup<T>[] {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const key = dayKeyOf(item);
        const existing = groups.get(key);
        if (existing) existing.push(item);
        else groups.set(key, [item]);
    }

    return Array.from(groups.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        // formatDate is still date-fns, but it now runs once per *group* rather than
        // once per photo — hundreds of calls instead of tens of thousands.
        .map(([date, groupItems]) => ({
            date,
            label: formatDate(date),
            items: groupItems,
        }));
}
