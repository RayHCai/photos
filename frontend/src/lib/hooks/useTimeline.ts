'use client';

import { useQuery } from '@tanstack/react-query';
import { getTimeline } from '../api/media';

/**
 * The library-wide timeline (`GET /media/timeline`, authenticated).
 *
 * `enabled` exists so a scoped surface — a collection, the hidden view, a public
 * share — can switch this off. Those pass their own timeline; the share view has
 * no session at all, so an unconditional fetch here 401'd on every guest load.
 */
export function useTimeline(enabled: boolean = true) {
    return useQuery({
        queryKey: ['media', 'timeline'],
        queryFn: getTimeline,
        staleTime: 60_000,
        enabled,
    });
}
