'use client';

import { useQuery } from '@tanstack/react-query';
import { search } from '../api/search';
import { useDebounce } from './useDebounce';
import type { MediaType } from '../types/media';

export function useSearch(query: string, type?: MediaType) {
    const debouncedQuery = useDebounce(query, 300);

    return useQuery({
        queryKey: ['search', debouncedQuery, type],
        queryFn: () => search({ q: debouncedQuery, type, limit: 100 }),
        enabled: debouncedQuery.length > 0,
    });
}
