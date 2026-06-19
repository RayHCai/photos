'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { listMedia } from '../api/media';
import type { MediaType } from '../types/media';

export function useMediaList(params?: {
    type?: MediaType;
    sort?: 'date_asc' | 'date_desc';
    /** Gate the query — e.g. only fetch while the picker dialog is open. */
    enabled?: boolean;
}) {
    return useInfiniteQuery({
        queryKey: ['media', params?.type, params?.sort],
        queryFn: ({ pageParam }) =>
            listMedia({
                cursor: pageParam as string | undefined,
                limit: 50,
                type: params?.type,
                sort: params?.sort,
            }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
        initialPageParam: undefined as string | undefined,
        enabled: params?.enabled ?? true,
    });
}
