/**
 * Every TanStack Query key in the app, in one place, plus the invalidation sets
 * that keep them coherent.
 *
 * Cache invalidation was previously decided per mutation site, and each site chose
 * its own subset. Because `['media']` does not prefix-match `['collections', id]`,
 * `['persons', id, 'media']` or `['search', q]`, deleting or hiding a photo left it
 * on screen in every one of those views — clicking a deleted tile opened a lightbox
 * whose requests 404'd into a permanent spinner. Two hooks for the same operation
 * (useFavorites and useHidden) also invalidated different sets, so the same action
 * behaved differently depending on which screen triggered it.
 *
 * Rule: mutations declare *what changed* (see `invalidationsFor`), never a
 * hand-picked list of keys.
 */
export const queryKeys = {
    media: {
        all: ['media'] as const,
        shell: () => ['media', 'shell'] as const,
        timeline: () => ['media', 'timeline'] as const,
        processing: () => ['media', 'processing'] as const,
        list: (params?: Record<string, unknown>) =>
            params ? (['media', 'list', params] as const) : (['media', 'list'] as const),
        detail: (id: string) => ['media', 'detail', id] as const,
    },
    collections: {
        all: ['collections'] as const,
        list: () => ['collections', 'list'] as const,
        detail: (id: string) => ['collections', 'detail', id] as const,
        favorites: () => ['collections', 'favorites'] as const,
        favoriteIds: () => ['collections', 'favorites', 'ids'] as const,
        hidden: () => ['collections', 'hidden'] as const,
        hiddenIds: () => ['collections', 'hidden', 'ids'] as const,
        // Sorted ids, so the same logical selection always hashes to one key. An
        // unsorted list meant dragging a selection in a different direction produced
        // a brand-new key and therefore a fresh network request.
        membership: (mediaItemIds: string[]) =>
            ['collections', 'membership', [...mediaItemIds].sort().join(',')] as const,
        shareLinks: (collectionId: string) =>
            ['collections', collectionId, 'share-links'] as const,
    },
    persons: {
        all: ['persons'] as const,
        list: () => ['persons', 'list'] as const,
        detail: (id: string) => ['persons', 'detail', id] as const,
        media: (id: string) => ['persons', id, 'media'] as const,
    },
    search: {
        all: ['search'] as const,
        query: (q: string, type?: string) => ['search', q, type ?? null] as const,
    },
    jobs: {
        all: ['jobs'] as const,
        stats: () => ['jobs', 'stats'] as const,
        storageStats: () => ['jobs', 'storage-stats'] as const,
        processingStats: () => ['jobs', 'processing-stats'] as const,
    },
    auth: {
        status: () => ['auth', 'status'] as const,
    },
} as const;

/** The kinds of change a mutation can cause. */
export type MutationEffect =
    /** A media item was created or destroyed. */
    | 'media-set'
    /** A media item's own fields changed (reprocessed, renamed). */
    | 'media-content'
    /** Album membership changed, including favorites/hidden. */
    | 'collection-membership'
    /** An album itself was created, renamed or deleted. */
    | 'collection-set'
    /** Face/person assignments or names changed. */
    | 'persons'
    /** A share link was created or revoked. */
    | 'share-links';

type Key = readonly unknown[];

/**
 * Query-key prefixes to invalidate for a set of effects.
 *
 * Deliberately broad: an over-invalidation costs one refetch, whereas a missed
 * invalidation shows the user data they have already deleted.
 */
export function invalidationsFor(effects: readonly MutationEffect[]): Key[] {
    const keys: Key[] = [];

    const add = (key: Key) => {
        if (!keys.some((k) => k.length === key.length && k.every((p, i) => p === key[i]))) {
            keys.push(key);
        }
    };

    for (const effect of effects) {
        switch (effect) {
        case 'media-set':
            // Removing or adding a photo changes the timeline, every album that
            // contained it, every person who appears in it, and any search result.
            add(queryKeys.media.all);
            add(queryKeys.collections.all);
            add(queryKeys.persons.all);
            add(queryKeys.search.all);
            add(queryKeys.jobs.all);
            break;
        case 'media-content':
            add(queryKeys.media.all);
            add(queryKeys.search.all);
            break;
        case 'collection-membership':
            // Hiding is membership of the HIDDEN album, and hidden items are
            // excluded from the timeline, persons and search on the server — so
            // those all change too.
            add(queryKeys.collections.all);
            add(queryKeys.media.all);
            add(queryKeys.persons.all);
            add(queryKeys.search.all);
            break;
        case 'collection-set':
            add(queryKeys.collections.all);
            break;
        case 'persons':
            add(queryKeys.persons.all);
            add(queryKeys.collections.all);
            add(queryKeys.search.all);
            break;
        case 'share-links':
            add(queryKeys.collections.all);
            break;
        }
    }

    return keys;
}
