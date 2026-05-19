import { format } from 'date-fns';
import { formatDate } from './format';
import type { MediaListItem } from '../types/media';

export interface DateGroup {
    date: string;
    label: string;
    items: MediaListItem[];
}

export function groupByDate(items: MediaListItem[]): DateGroup[] {
    const groups = new Map<string, MediaListItem[]>();

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

    return Array.from(groups.entries()).map(([date, groupItems]) => ({
        date,
        label: formatDate(date + 'T00:00:00'),
        items: groupItems,
    }));
}
