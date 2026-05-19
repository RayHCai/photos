'use client';

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as personsApi from '../api/persons';

export function usePersons() {
    return useQuery({
        queryKey: ['persons'],
        queryFn: personsApi.listPersons,
    });
}

export function usePerson(id: string) {
    return useQuery({
        queryKey: ['persons', id],
        queryFn: () => personsApi.getPerson(id),
        enabled: !!id,
    });
}

export function usePersonMedia(personId: string | null) {
    return useInfiniteQuery({
        queryKey: ['persons', personId, 'media'],
        queryFn: ({ pageParam }) =>
            personsApi.getPersonMedia(personId!, {
                cursor: pageParam as string | undefined,
                limit: 50,
            }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
        initialPageParam: undefined as string | undefined,
        enabled: !!personId,
    });
}

export function useRenamePerson() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            personsApi.renamePerson(id, name),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['persons'] });
        },
    });
}

export function useMergePersons() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
            personsApi.mergePersons(sourceId, targetId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['persons'] });
        },
    });
}

export function useDeletePerson() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: personsApi.deletePerson,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['persons'] });
        },
    });
}
