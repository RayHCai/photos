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
        onSuccess: (data: TData, variables: TVariables) => {
            const keys = typeof invalidateKeys === 'function'
                ? invalidateKeys(data, variables)
                : invalidateKeys;
            keys.forEach((key) =>
                queryClient.invalidateQueries({ queryKey: key })
            );
        },
    });
}
