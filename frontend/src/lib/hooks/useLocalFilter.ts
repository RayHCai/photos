import { useMemo } from 'react';

export function useLocalFilter<T>(
    items: T[] | undefined,
    query: string,
    getField: (item: T) => string | null | undefined
): T[] {
    return useMemo(() => {
        if (!items) return [];
        if (!query.trim()) return items;
        const q = query.toLowerCase();
        return items.filter((item) =>
            getField(item)?.toLowerCase().includes(q)
        );
    }, [items, query, getField]);
}
