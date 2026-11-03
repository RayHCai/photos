'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as contributionsApi from '../api/contributions';
import { getCollectionEvents, getEventUploads, undoCollectionEvents } from '../api/collections';
import { getSharedEvents } from '../api/share';
import { queryKeys } from '../queries/keys';
import { useAppMutation } from './useAppMutation';
import { pluralize } from '../utils/pluralize';

/**
 * Decisions on guest uploads. Silent on success: each is one click in a grid
 * that already shows its result, and a toast per click would bury the screen.
 */
export function useApproveContributions() {
    return useAppMutation({
        mutationFn: contributionsApi.approveContributions,
        effects: ['contributions'],
    });
}

export function useRejectContributions() {
    return useAppMutation({
        mutationFn: contributionsApi.rejectContributions,
        effects: ['contributions'],
    });
}

/** An album's change log, newest first. */
export function useCollectionEvents(collectionId: string, enabled = true) {
    return useInfiniteQuery({
        queryKey: queryKeys.collections.events(collectionId),
        queryFn: ({ pageParam }) => getCollectionEvents(collectionId, { cursor: pageParam }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
        enabled,
    });
}

/** The files in one upload entry, for its review modal. */
export function useEventUploads(collectionId: string, eventId: string | null) {
    return useQuery({
        queryKey: queryKeys.collections.eventUploads(collectionId, eventId ?? ''),
        queryFn: () => getEventUploads(collectionId, eventId!),
        enabled: eventId !== null,
    });
}

/** A shared album's change log, as a guest sees it. */
export function useSharedEvents(slug: string, enabled = true) {
    return useInfiniteQuery({
        queryKey: ['share', slug, 'events'],
        queryFn: ({ pageParam }) => getSharedEvents(slug, { cursor: pageParam }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
        enabled,
    });
}

export function useUndoCollectionEvents(collectionId: string) {
    return useAppMutation({
        mutationFn: (eventIds: string[]) => undoCollectionEvents(collectionId, eventIds),
        // An undo can add or remove album items, rename the album or revoke a link.
        effects: ['collection-membership', 'collection-set', 'share-links'],
        successMessage: ({ undone, skipped }) =>
            skipped.length > 0
                ? `Undid ${pluralize(undone.length, 'change')}; ${skipped.length} could not be undone`
                : `Undid ${pluralize(undone.length, 'change')}`,
    });
}
