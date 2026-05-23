'use client';

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useMutationWithInvalidation } from './useMutationWithInvalidation';
import * as personsApi from '../api/persons';

export function usePersons() {
    return useQuery({
        queryKey: ['persons'],
        queryFn: personsApi.listPersons,
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
    return useMutationWithInvalidation(
        ({ id, name }: { id: string; name: string }) => personsApi.renamePerson(id, name),
        [['persons']]
    );
}

export function useMergePersons() {
    return useMutationWithInvalidation(
        ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
            personsApi.mergePersons(sourceId, targetId),
        [['persons']]
    );
}

export function useDeletePerson() {
    return useMutationWithInvalidation(personsApi.deletePerson, [['persons']]);
}

export function useSharePerson() {
    return useMutationWithInvalidation(personsApi.sharePerson, [['collections']]);
}
