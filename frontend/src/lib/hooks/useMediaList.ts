'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { listMedia } from '../api/media';

export function useMediaList(params?: {
    type?: 'PHOTO' | 'VIDEO';
    sort?: 'date_asc' | 'date_desc';
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
        refetchInterval: 10_000,
    });
}
