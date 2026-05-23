import { format } from 'date-fns';
import { formatDate } from './format';
import type { MediaShellItem } from '../types/media';

interface DateGroup<T extends MediaShellItem = MediaShellItem> {
    date: string;
    label: string;
    items: T[];
}

export function groupByDate<T extends MediaShellItem>(items: T[]): DateGroup<T>[] {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const dateStr = item.takenAt || item.createdAt;
        const key = format(new Date(dateStr), 'yyyy-MM-dd');
        const existing = groups.get(key);
        if (existing) {
            existing.push(item);
        }
        else {
            groups.set(key, [item]);
        }
    }

    return Array.from(groups.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, groupItems]) => ({
            date,
            label: formatDate(date),
            items: groupItems,
        }));
}
