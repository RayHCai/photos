'use client';

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../api/client';
import { invalidationsFor, type MutationEffect } from '../queries/keys';

interface AppMutationOptions<TData, TVars, TContext>
    extends Omit<UseMutationOptions<TData, Error, TVars, TContext>, 'mutationFn'> {
    mutationFn: (vars: TVars) => Promise<TData>;
    /** What this mutation changes. Drives cache invalidation. */
    effects: readonly MutationEffect[];
    /** Toast shown on success. Omit for silent mutations. */
    successMessage?: string | ((data: TData, vars: TVars) => string);
    /** Toast shown on failure. Defaults to the server's message. */
    errorMessage?: string;
}

/**
 * The single mutation wrapper for the app.
 *
 * Guarantees that every mutation invalidates a complete, consistent key set and
 * surfaces its own failures. Previously each call site hand-picked keys (so some
 * views kept showing deleted photos) and several fired mutations without `await` or
 * `.catch`, making a 500 an unhandled rejection with no user-visible feedback at
 * all.
 */
export function useAppMutation<TData = unknown, TVars = void, TContext = unknown>({
    mutationFn,
    effects,
    successMessage,
    errorMessage,
    onSettled,
    onError,
    ...rest
}: AppMutationOptions<TData, TVars, TContext>) {
    const queryClient = useQueryClient();

    return useMutation<TData, Error, TVars, TContext>({
        ...rest,
        mutationFn,
        onError: (...args) => {
            const [error] = args;
            const message =
                errorMessage ??
                (error instanceof ApiError ? error.message : 'Something went wrong');
            toast.error(message);
            onError?.(...args);
        },
        onSettled: (...args) => {
            const [data, error, vars] = args;
            // Always on settled, not only on success: a failed mutation may still
            // have partially applied server-side, so the cache is suspect either way.
            for (const key of invalidationsFor(effects)) {
                // Fire-and-forget: refetches proceed in the background and their
                // failures surface through the queries themselves.
                queryClient.invalidateQueries({ queryKey: key }).catch(() => undefined);
            }
            if (!error && successMessage) {
                toast.success(
                    typeof successMessage === 'function'
                        ? successMessage(data as TData, vars)
                        : successMessage
                );
            }
            onSettled?.(...args);
        },
    });
}
