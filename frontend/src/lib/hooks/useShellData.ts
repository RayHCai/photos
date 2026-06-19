'use client';

import { useQuery } from '@tanstack/react-query';
import { getShellData } from '../api/media';

export function useShellData() {
    return useQuery({
        queryKey: ['media', 'shell'],
        queryFn: getShellData,
        staleTime: 60_000,
        // Don't poll a fully-processed library — membership mutations already
        // invalidate ['media'] (delete/retry/hide/upload). But the worker flips
        // items PENDING/PROCESSING → COMPLETED server-side with no client event,
        // so poll briefly while any tile is still in-flight, then stop.
        refetchInterval: (query) =>
            query.state.data?.some(
                (i) => i.processingStatus === 'PENDING' || i.processingStatus === 'PROCESSING'
            )
                ? 5_000
                : false,
    });
}
