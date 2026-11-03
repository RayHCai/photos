/**
 * Scroll anchoring for the windowed gallery, expressed as a *leading space* rather
 * than as scrollTop corrections.
 *
 * The loaded rows are a sliding window of pages. When the window slides — a page
 * evicted from the top as the user scrolls down, or one prepended as they scroll
 * back up — every surviving row's offset changes while the browser keeps `scrollTop`
 * numerically fixed, so the content under the user would jump.
 *
 * The grid used to compensate by writing `scrollTop`. On WebKit a scrollTop write
 * during a momentum fling stops the fling dead, so every page boundary ended the
 * user's flick. Instead the grid keeps an empty strip above the first loaded row
 * (`paddingStart` on the virtualizer) whose height stands in for the evicted pages:
 * an eviction grows the strip by exactly the height it removed, a prepend shrinks it,
 * and the surviving rows never move on screen — without touching scrollTop at all.
 *
 * scrollTop is written only when the strip cannot absorb the change: a prepend larger
 * than the strip (possible only right after a jump), and reaching the start of the
 * library, where the strip must be exactly zero or blank space would show above the
 * newest photo.
 */

export interface AnchorRow {
    /** Stable identity of the row, independent of its position. */
    key: string;
    height: number;
}

export interface WindowShift {
    /** Height of the empty strip above the first row, once applied. */
    leadingSpace: number;
    /** scrollTop that keeps the anchor row in place once `leadingSpace` is applied. */
    scrollTop: number;
    /** False when no row survived: the whole window was replaced, i.e. a jump. */
    anchored: boolean;
}

export interface WindowShiftOptions {
    /**
     * The window now starts at the first item of the library, so nothing can be
     * above it and the strip must collapse to zero.
     */
    atLibraryStart: boolean;
}

/**
 * How the strip and scrollTop must change so that the first row at or below the
 * viewport's top edge that survives from `prevRows` into `nextRows` stays at the same
 * place on screen.
 *
 * Walks the OLD rows from the top edge downward and anchors to the *first* one that
 * still exists in the new layout. A window slide leaves the straddling top-edge row
 * intact, so this lands on it exactly. An invalidation that shifted the source — a
 * delete or hide above a deep window — replaces that row's identity; anchoring to the
 * nearest surviving row below keeps the jump to a fraction of a row rather than
 * letting the browser hold scrollTop fixed over content that moved by a whole page.
 */
export function computeWindowShift(
    prevRows: readonly AnchorRow[],
    nextRows: readonly AnchorRow[],
    scrollTop: number,
    leadingSpace: number,
    { atLibraryStart }: WindowShiftOptions,
): WindowShift {
    const newOffsets = new Map<string, number>();
    let acc = 0;
    for (const r of nextRows) {
        newOffsets.set(r.key, acc);
        acc += r.height;
    }

    let oldOff = 0;
    let reachedTopEdge = false;
    let anchor: { oldOff: number; newOff: number } | null = null;
    for (const r of prevRows) {
        if (leadingSpace + oldOff + r.height > scrollTop) reachedTopEdge = true;
        if (reachedTopEdge) {
            const newOff = newOffsets.get(r.key);
            if (newOff !== undefined) {
                anchor = { oldOff, newOff };
                break;
            }
        }
        oldOff += r.height;
    }

    if (!anchor) return { leadingSpace, scrollTop, anchored: false };

    let result: WindowShift;
    if (scrollTop <= 0 && leadingSpace === 0) {
        // Pinned to the very top: new rows above (an upload) should appear there,
        // with the viewport staying at the top.
        result = { leadingSpace, scrollTop, anchored: true };
    }
    else {
        const want = leadingSpace + anchor.oldOff - anchor.newOff;
        result = want >= 0
            ? { leadingSpace: want, scrollTop, anchored: true }
            // The strip cannot shrink below zero: the rest of the correction has to
            // come from scrollTop.
            : { leadingSpace: 0, scrollTop: scrollTop - want, anchored: true };
    }

    if (atLibraryStart && result.leadingSpace > 0) {
        result = {
            leadingSpace: 0,
            scrollTop: Math.max(0, result.scrollTop - result.leadingSpace),
            anchored: true,
        };
    }

    return result;
}

/**
 * A plausible strip height for the items above a window that was just rebuilt by a
 * jump. Nothing on screen survived a jump, so there is no anchor to measure against;
 * an estimate gives later prepends room to land without a scrollTop write. Any error
 * only shows up as the size of the one correction made on reaching the library start.
 */
export function estimateLeadingSpace(windowStart: number, itemsPerRow: number, rowHeight: number): number {
    if (windowStart <= 0 || itemsPerRow <= 0 || rowHeight <= 0) return 0;
    return Math.ceil(windowStart / itemsPerRow) * rowHeight;
}
