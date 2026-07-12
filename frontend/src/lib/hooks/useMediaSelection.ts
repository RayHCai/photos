'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type DragMode = 'add' | 'remove';

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

    const toggle = useCallback((id: string) => {
        lastSelectedIdRef.current = id;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            }
            else {
                next.add(id);
            }
            if (next.size === 0) {
                setIsSelecting(false);
            }
            return next;
        });
    }, []);

    const addRange = useCallback((toId: string, orderedIds: string[]) => {
        const fromId = lastSelectedIdRef.current;
        if (!fromId) {
            lastSelectedIdRef.current = toId;
            setSelectedIds((prev) => {
                const next = new Set(prev);
                next.add(toId);
                return next;
            });
            return;
        }
        const fromIndex = orderedIds.indexOf(fromId);
        const toIndex = orderedIds.indexOf(toId);
        if (fromIndex === -1 || toIndex === -1) return;
        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
                next.add(orderedIds[i]);
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

    const handleSelect = useCallback((id: string, orderedIds: string[], e: React.MouseEvent) => {
        if (!isSelecting) setIsSelecting(true);
        if (e.shiftKey) {
            addRange(id, orderedIds);
        }
        else {
            toggle(id);
        }
    }, [isSelecting, addRange, toggle]);

    // --- Drag-to-select ("paint") ---------------------------------------------
    // Begin a paint gesture anchored at `anchorId`. Snapshots the current
    // selection so the swept range can be applied non-destructively and updated
    // live (reversing direction un-paints). The anchor's current state decides the
    // mode: dragging from an unselected photo adds, from a selected photo removes
    // (matching iOS Photos).
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

    // Update the paint to the item currently under the finger. Applies the mode to
    // every item in the visual range [anchor..current], layered over the snapshot
    // so items swept then abandoned revert.
    const updateDrag = useCallback((currentId: string, orderedIds: string[]) => {
        const anchorId = dragAnchorRef.current;
        if (anchorId === null) return;

        const anchorIndex = orderedIds.indexOf(anchorId);
        const currentIndex = orderedIds.indexOf(currentId);
        if (anchorIndex === -1 || currentIndex === -1) return;

        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        const mode = dragModeRef.current;
        const next = new Set(dragBaseRef.current);
        for (let i = start; i <= end; i++) {
            if (mode === 'add') next.add(orderedIds[i]);
            else next.delete(orderedIds[i]);
        }
        setSelectedIds(next);
        lastSelectedIdRef.current = currentId;
    }, []);

    // End a paint gesture. Leaves the selection as painted; only drops out of
    // selection mode if the gesture cleared everything.
    const endDrag = useCallback(() => {
        dragAnchorRef.current = null;
        dragBaseRef.current = new Set();
        if (selectedIdsRef.current.size === 0) {
            setIsSelecting(false);
            lastSelectedIdRef.current = null;
        }
    }, []);

    return {
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
    };
}
