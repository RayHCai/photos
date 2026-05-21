'use client';

import { useQuery } from '@tanstack/react-query';
import { getTimeline } from '../api/media';

export function useTimeline() {
    return useQuery({
        queryKey: ['media', 'timeline'],
        queryFn: getTimeline,
        staleTime: 60_000,
    });
}
