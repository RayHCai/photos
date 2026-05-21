'use client';

import { useQuery } from '@tanstack/react-query';
import { getShellData } from '../api/media';

export function useShellData() {
    return useQuery({
        queryKey: ['media', 'shell'],
        queryFn: getShellData,
        staleTime: 60_000,
        refetchInterval: 30_000,
    });
}
