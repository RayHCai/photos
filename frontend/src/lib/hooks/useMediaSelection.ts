'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

type DragMode = 'add' | 'remove';

/** Resolves an item id to its position in the current visual order. */
export type IndexLookup = ReadonlyMap<string, number>;

export function useMediaSelection() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelecting, setIsSelecting] = useState(false);
    const lastSelectedIdRef = useRef<string | null>(null);

    // Always-fresh mirror of selectedIds so imperative callers (touch drag-select,
    // which fires across separate event frames) can snapshot the current selection
    // without depending on a stale render closure.
    const selectedIdsRef = useRef(selectedIds);
    useEffect(() => {
        selectedIdsRef.current = selectedIds;
    }, [selectedIds]);

    // Drag-to-select ("paint") state. Held in refs because it mutates during raw
    // touch/rAF handlers between renders.
    const dragAnchorRef = useRef<string | null>(null);
    const dragBaseRef = useRef<Set<string>>(new Set());
    const dragModeRef = useRef<DragMode>('add');
    const dragRafRef = useRef(0);
    const pendingDragRef = useRef<{
        currentId: string;
        orderedIds: string[];
        index: IndexLookup;
    } | null>(null);

    const toggle = useCallback((id: string) => {
        lastSelectedIdRef.current = id;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            if (next.size === 0) setIsSelecting(false);
            return next;
        });
    }, []);

    const addRange = useCallback((toId: string, orderedIds: string[], index: IndexLookup) => {
        const fromId = lastSelectedIdRef.current;
        if (!fromId) {
            lastSelectedIdRef.current = toId;
            setSelectedIds((prev) => new Set(prev).add(toId));
            return;
        }

        // Map lookups rather than two O(n) indexOf scans over the whole library.
        const fromIndex = index.get(fromId);
        const toIndex = index.get(toId);
        if (fromIndex === undefined || toIndex === undefined) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
                const id = orderedIds[i];
                if (id) next.add(id);
            }
            return next;
        });
        lastSelectedIdRef.current = toId;
    }, []);

    const selectAll = useCallback((ids: string[]) => {
        setSelectedIds(new Set(ids));
        setIsSelecting(true);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setIsSelecting(false);
        lastSelectedIdRef.current = null;
    }, []);

    const startSelecting = useCallback(() => {
        setIsSelecting(true);
    }, []);

    const handleSelect = useCallback(
        (id: string, orderedIds: string[], index: IndexLookup, e: React.MouseEvent) => {
            if (!isSelecting) setIsSelecting(true);
            if (e.shiftKey) addRange(id, orderedIds, index);
            else toggle(id);
        },
        [isSelecting, addRange, toggle]
    );

    // --- Drag-to-select ("paint") ---------------------------------------------

    const beginDrag = useCallback((anchorId: string) => {
        const base = new Set(selectedIdsRef.current);
        const mode: DragMode = base.has(anchorId) ? 'remove' : 'add';
        dragAnchorRef.current = anchorId;
        dragBaseRef.current = base;
        dragModeRef.current = mode;
        lastSelectedIdRef.current = anchorId;
        setIsSelecting(true);

        const next = new Set(base);
        if (mode === 'add') next.add(anchorId);
        else next.delete(anchorId);
        setSelectedIds(next);
    }, []);

    const commitDrag = useCallback(() => {
        dragRafRef.current = 0;
        const pending = pendingDragRef.current;
        pendingDragRef.current = null;
        if (!pending) return;

        const anchorId = dragAnchorRef.current;
        if (anchorId === null) return;

        const anchorIndex = pending.index.get(anchorId);
        const currentIndex = pending.index.get(pending.currentId);
        if (anchorIndex === undefined || currentIndex === undefined) return;

        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        const mode = dragModeRef.current;

        const next = new Set(dragBaseRef.current);
        for (let i = start; i <= end; i++) {
            const id = pending.orderedIds[i];
            if (!id) continue;
            if (mode === 'add') next.add(id);
            else next.delete(id);
        }
        setSelectedIds(next);
        lastSelectedIdRef.current = pending.currentId;
    }, []);

    /**
     * Extend the paint to the item under the finger.
     *
     * rAF-coalesced: touchmove fires far more often than the display refreshes, and
     * each raw event previously ran two full-library `indexOf` scans, cloned the
     * entire existing selection, and committed a state update that re-rendered every
     * visible cell. At most one commit per frame now, and the range lookup is O(1).
     */
    const updateDrag = useCallback(
        (currentId: string, orderedIds: string[], index: IndexLookup) => {
            if (dragAnchorRef.current === null) return;
            pendingDragRef.current = { currentId, orderedIds, index };
            if (dragRafRef.current === 0) {
                dragRafRef.current = requestAnimationFrame(commitDrag);
            }
        },
        [commitDrag]
    );

    const endDrag = useCallback(() => {
        if (dragRafRef.current !== 0) {
            cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = 0;
            // Apply whatever the last move asked for, so the gesture does not end a
            // frame short of where the finger actually was.
            commitDrag();
        }
        dragAnchorRef.current = null;
        dragBaseRef.current = new Set();
        if (selectedIdsRef.current.size === 0) {
            setIsSelecting(false);
            lastSelectedIdRef.current = null;
        }
    }, [commitDrag]);

    useEffect(
        () => () => {
            if (dragRafRef.current !== 0) cancelAnimationFrame(dragRafRef.current);
        },
        []
    );

    // Memoized so the object identity is stable. It used to be a fresh literal on
    // every render, which changed the identity of every callback derived from it and
    // defeated `memo` on every gallery row.
    return useMemo(
        () => ({
            selectedIds,
            isSelecting,
            toggle,
            addRange,
            selectAll,
            clearSelection,
            startSelecting,
            handleSelect,
            beginDrag,
            updateDrag,
            endDrag,
            count: selectedIds.size,
        }),
        [
            selectedIds,
            isSelecting,
            toggle,
            addRange,
            selectAll,
            clearSelection,
            startSelecting,
            handleSelect,
            beginDrag,
            updateDrag,
            endDrag,
        ]
    );
}
