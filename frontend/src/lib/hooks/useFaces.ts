'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as facesApi from '../api/faces';

export function useUnassignedFaces() {
    return useInfiniteQuery({
        queryKey: ['faces', 'unassigned'],
        queryFn: ({ pageParam }) =>
            facesApi.listUnassignedFaces({
                cursor: pageParam as string | undefined,
                limit: 50,
            }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
        initialPageParam: undefined as string | undefined,
    });
}

export function useAssignFace() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ faceId, personId }: { faceId: string; personId: string }) =>
            facesApi.assignFace(faceId, personId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faces'] });
            queryClient.invalidateQueries({ queryKey: ['persons'] });
        },
    });
}

export function useUnassignFace() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: facesApi.unassignFace,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['faces'] });
            queryClient.invalidateQueries({ queryKey: ['persons'] });
        },
    });
}
