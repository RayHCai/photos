'use client';

import { useState, useCallback, useRef } from 'react';

export function useMediaSelection() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelecting, setIsSelecting] = useState(false);
    const lastSelectedIdRef = useRef<string | null>(null);

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

    return {
        selectedIds,
        isSelecting,
        toggle,
        addRange,
        selectAll,
        clearSelection,
        startSelecting,
        count: selectedIds.size,
    };
}
