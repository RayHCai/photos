import { format, parse } from 'date-fns';
import type { TimelineMonth } from '@/lib/types/media';

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

// ---------------------------------------------------------------------------
// Binary-search date index (replaces O(n) findCurrentDate)
// ---------------------------------------------------------------------------

interface DateIndexEntry {
    scrollTop: number;
    date: string;
}

/**
 * One-time O(n) pass over virtualRows to build a sorted index of date-header
 * positions. Memoize this in a useMemo keyed on virtualRows.
 */
export function buildDateIndex(
    virtualRows: Array<{ type: string; height: number; date?: string }>,
): DateIndexEntry[] {
    const index: DateIndexEntry[] = [];
    let cumHeight = 0;
    for (const row of virtualRows) {
        if (row.type === 'date-header' && row.date) {
            index.push({ scrollTop: cumHeight, date: row.date });
        }
        cumHeight += row.height;
    }
    return index;
}

/**
 * O(log n) binary search to find the date header at a given scroll position.
 */
export function findCurrentDateBinary(
    index: DateIndexEntry[],
    scrollTop: number,
): string | null {
    if (index.length === 0) return null;

    let lo = 0;
    let hi = index.length - 1;
    let result = 0;

    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (index[mid].scrollTop <= scrollTop) {
            result = mid;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }

    return index[result].date;
}

// ---------------------------------------------------------------------------
// Adaptive timeline label compression
// ---------------------------------------------------------------------------

const MIN_LABEL_GAP = 28;

/**
 * Compute visible timeline labels that adapt their granularity to the
 * available track height. Always pins the first (newest) and last (oldest)
 * markers. Tries month → bi-month → quarter → semi-annual → year → 2yr → 5yr.
 */
export function computeAdaptiveLabels(
    markers: TimelineMarker[],
    trackHeight: number,
): Array<{ label: string; top: number }> {
    if (markers.length === 0 || trackHeight <= 0) return [];

    if (markers.length === 1) {
        return [{ label: markers[0].label, top: markers[0].fraction * trackHeight }];
    }

    const granularities = [1, 2, 3, 6, 12, 24, 60];

    let bestLabels: Array<{ label: string; top: number }> = [];

    for (const gran of granularities) {
        const candidates = selectMarkers(markers, gran);
        const labels = layoutWithCollision(candidates, trackHeight, gran);
        bestLabels = labels;
        // If all candidates survived collision avoidance, this is the finest
        // granularity that fits — use it.
        if (labels.length >= candidates.length) break;
    }

    return bestLabels;
}

/** Filter markers to a calendar-aligned granularity, always keeping first & last. */
function selectMarkers(markers: TimelineMarker[], monthInterval: number): TimelineMarker[] {
    if (monthInterval <= 1) return markers;

    const first = markers[0];
    const last = markers[markers.length - 1];
    const result: TimelineMarker[] = [first];

    for (let i = 1; i < markers.length - 1; i++) {
        const [yearStr, monthStr] = markers[i].monthKey.split('-');
        const month = parseInt(monthStr, 10);
        const year = parseInt(yearStr, 10);

        let include = false;
        if (monthInterval >= 60) {
            include = month === 1 && year % 5 === 0;
        }
        else if (monthInterval >= 24) {
            include = month === 1 && year % 2 === 0;
        }
        else if (monthInterval >= 12) {
            include = month === 1;
        }
        else if (monthInterval >= 6) {
            include = month === 1 || month === 7;
        }
        else if (monthInterval >= 3) {
            include = (month - 1) % 3 === 0; // Jan, Apr, Jul, Oct
        }
        else if (monthInterval >= 2) {
            include = month % 2 === 1; // Jan, Mar, May, Jul, Sep, Nov
        }

        if (include) result.push(markers[i]);
    }

    if (last !== first) result.push(last);
    return result;
}

/** Place labels along the track with collision avoidance, pinning first & last. */
function layoutWithCollision(
    candidates: TimelineMarker[],
    trackHeight: number,
    granularity: number,
): Array<{ label: string; top: number }> {
    if (candidates.length === 0) return [];

    if (candidates.length === 1) {
        return [{ label: formatMarkerLabel(candidates[0], granularity), top: candidates[0].fraction * trackHeight }];
    }

    const result: Array<{ label: string; top: number }> = [];
    const lastCandidate = candidates[candidates.length - 1];
    const lastTop = lastCandidate.fraction * trackHeight;

    let lastPlacedY = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const m = candidates[i];
        const y = m.fraction * trackHeight;
        const isFirst = i === 0;
        const isLast = i === candidates.length - 1;

        if (isFirst) {
            result.push({ label: formatMarkerLabel(m, granularity), top: y });
            lastPlacedY = y;
            continue;
        }

        if (isLast) {
            // Remove interior labels that collide with the pinned last label
            while (result.length > 1 && y - result[result.length - 1].top < MIN_LABEL_GAP) {
                result.pop();
            }
            if (y - (result.length > 0 ? result[result.length - 1].top : -Infinity) >= MIN_LABEL_GAP) {
                result.push({ label: formatMarkerLabel(m, granularity), top: y });
            }
            continue;
        }

        // Interior: must have room from previous label AND from reserved last label
        if (y - lastPlacedY >= MIN_LABEL_GAP && lastTop - y >= MIN_LABEL_GAP) {
            result.push({ label: formatMarkerLabel(m, granularity), top: y });
            lastPlacedY = y;
        }
    }

    return result;
}

/** Format label based on granularity — year-only for January markers at yearly+ granularity. */
function formatMarkerLabel(marker: TimelineMarker, granularity: number): string {
    if (granularity >= 12) {
        const month = parseInt(marker.monthKey.split('-')[1], 10);
        if (month === 1) return marker.monthKey.split('-')[0]; // "2024"
    }
    return marker.label; // "Jan 2024"
}

