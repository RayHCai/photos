'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

type InvalidateKeys<TData, TVariables> =
    | QueryKey[]
    | ((data: TData, variables: TVariables) => QueryKey[]);

export function useMutationWithInvalidation<TData, TVariables>(
    mutationFn: (variables: TVariables) => Promise<TData>,
    invalidateKeys: InvalidateKeys<TData, TVariables>
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        // Invalidate on settled, not only on success. A failed mutation may still
        // have applied server-side, so the cache is suspect either way — and a
        // failed add/remove used to leave a collection's windowed item list stale
        // until the next hard refresh. This matches useAppMutation's timing, so the
        // two wrappers no longer disagree on when a view refreshes. `data` is
        // undefined on error; no caller's key function dereferences it.
        onSettled: (data: TData | undefined, _error, variables: TVariables) => {
            const keys = typeof invalidateKeys === 'function'
                ? invalidateKeys(data as TData, variables)
                : invalidateKeys;
            keys.forEach((key) =>
                queryClient.invalidateQueries({ queryKey: key })
            );
        },
    });
}
