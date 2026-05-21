import { format, parse } from 'date-fns';
import { formatDate } from './format';
import type { TimelineMonth } from '@/lib/api/media';

export interface TimelineMarker {
    label: string;
    monthKey: string;
    /** Fraction 0..1 representing position on the track based on cumulative item count */
    fraction: number;
    count: number;
}

/**
 * Build markers from the full timeline API data.
 * Months come sorted newest-first (desc). Positions are proportional to cumulative counts.
 */
export function buildTimelineMarkers(timeline: TimelineMonth[]): TimelineMarker[] {
    if (timeline.length === 0) return [];

    const totalItems = timeline.reduce((sum, m) => sum + m.count, 0);
    if (totalItems === 0) return [];

    const markers: TimelineMarker[] = [];
    let cumulative = 0;

    for (const entry of timeline) {
        const date = parse(entry.month, 'yyyy-MM', new Date());
        markers.push({
            label: format(date, 'MMM yyyy'),
            monthKey: entry.month,
            fraction: cumulative / totalItems,
            count: entry.count,
        });
        cumulative += entry.count;
    }

    return markers;
}

/**
 * Find which marker corresponds to a given fraction (0..1) along the track.
 */
export function findMarkerAtFraction(markers: TimelineMarker[], fraction: number): TimelineMarker | null {
    if (markers.length === 0) return null;

    for (let i = markers.length - 1; i >= 0; i--) {
        if (markers[i].fraction <= fraction) {
            return markers[i];
        }
    }
    return markers[0];
}

/**
 * Given virtualRows (full layout), find the exact date (yyyy-MM-dd) at a scroll position.
 */
export function findCurrentDate(
    virtualRows: Array<{ type: string; height: number; date?: string }>,
    scrollTop: number,
): string | null {
    let cumHeight = 0;
    let lastDate: string | null = null;
    for (const row of virtualRows) {
        if (row.type === 'date-header' && row.date) {
            lastDate = row.date;
        }
        cumHeight += row.height;
        if (cumHeight > scrollTop) {
            return lastDate;
        }
    }
    return lastDate;
}

/**
 * Format a date key for display in the scrollbar tooltip.
 * Shows day-level precision (e.g., "May 12, 2024").
 */
export function formatDateLabel(dateKey: string): string {
    return formatDate(dateKey + 'T00:00:00');
}

