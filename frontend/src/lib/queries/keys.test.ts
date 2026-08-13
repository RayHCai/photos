import { describe, expect, it } from 'vitest';
import { invalidationsFor, queryKeys, type MutationEffect } from './keys';

/**
 * Does `prefix` prefix-match `key`, the way TanStack Query's invalidateQueries does?
 */
function matches(prefix: readonly unknown[], key: readonly unknown[]): boolean {
    return prefix.length <= key.length && prefix.every((part, i) => part === key[i]);
}

function invalidates(effects: MutationEffect[], key: readonly unknown[]): boolean {
    return invalidationsFor(effects).some((prefix) => matches(prefix, key));
}

/**
 * The regression these tests exist for.
 *
 * Invalidation used to be decided per mutation site, and every site picked its own
 * subset. Because `['media']` does not prefix-match `['collections', id]`,
 * `['persons', id, 'media']` or `['search', q]`, deleting or hiding a photo left it on
 * screen in all of those views — and clicking a deleted tile opened a lightbox whose
 * requests 404'd into a permanent spinner.
 */
describe('deleting a photo', () => {
    const effects: MutationEffect[] = ['media-set'];

    it.each([
        ['the timeline', queryKeys.media.shell()],
        ['the month counts', queryKeys.media.timeline()],
        ['a media detail', queryKeys.media.detail('m1')],
        ['a collection detail', queryKeys.collections.detail('c1')],
        ['the collection list', queryKeys.collections.list()],
        ['favorites', queryKeys.collections.favorites()],
        ['favorite ids', queryKeys.collections.favoriteIds()],
        ['hidden', queryKeys.collections.hidden()],
        ['a person', queryKeys.persons.detail('p1')],
        ['a person\'s photos', queryKeys.persons.media('p1')],
        ['the persons list', queryKeys.persons.list()],
        ['a search result set', queryKeys.search.query('beach')],
        ['a typed search result set', queryKeys.search.query('beach', 'PHOTO')],
        ['collection membership', queryKeys.collections.membership(['m1', 'm2'])],
        ['job stats', queryKeys.jobs.stats()],
    ])('invalidates %s', (_label, key) => {
        expect(invalidates(effects, key)).toBe(true);
    });

    it('does not invalidate auth status', () => {
        // Deleting a photo must not bounce the user's session state.
        expect(invalidates(effects, queryKeys.auth.status())).toBe(false);
    });
});

/**
 * Hiding is membership of the HIDDEN system collection, and the server excludes hidden
 * items from the timeline, persons and every search path — so all of those change too.
 * useHidden and useFavorites previously invalidated *different* sets for this same
 * operation, so the result depended on which screen you triggered it from.
 */
describe('hiding or favouriting a photo', () => {
    const effects: MutationEffect[] = ['collection-membership'];

    it.each([
        ['the timeline', queryKeys.media.shell()],
        ['favorite ids', queryKeys.collections.favoriteIds()],
        ['hidden ids', queryKeys.collections.hiddenIds()],
        ['the collection list', queryKeys.collections.list()],
        ['a person\'s photos', queryKeys.persons.media('p1')],
        ['search results', queryKeys.search.query('beach')],
    ])('invalidates %s', (_label, key) => {
        expect(invalidates(effects, key)).toBe(true);
    });
});

describe('renaming or merging a person', () => {
    const effects: MutationEffect[] = ['persons'];

    it.each([
        ['the persons list', queryKeys.persons.list()],
        ['a person\'s photos', queryKeys.persons.media('p1')],
        // A person's name feeds search query parsing and their auto-album's title.
        ['search results', queryKeys.search.query('ada')],
        ['the collection list', queryKeys.collections.list()],
    ])('invalidates %s', (_label, key) => {
        expect(invalidates(effects, key)).toBe(true);
    });
});

describe('revoking a share link', () => {
    it('invalidates the collection that owned it', () => {
        expect(
            invalidates(['share-links'], queryKeys.collections.shareLinks('c1'))
        ).toBe(true);
    });
});

describe('invalidationsFor', () => {
    it('returns nothing for no effects', () => {
        expect(invalidationsFor([])).toEqual([]);
    });

    it('de-duplicates overlapping effects', () => {
        const keys = invalidationsFor(['media-set', 'media-content', 'collection-membership']);
        const serialized = keys.map((k) => JSON.stringify(k));
        expect(new Set(serialized).size).toBe(serialized.length);
    });
});

/**
 * The membership key must be order-independent. Set iteration order differs by drag
 * direction, so an unsorted key meant the same logical selection hashed to several
 * different keys — each a cache miss, and therefore an immediate extra POST.
 */
describe('collection membership key', () => {
    it('is independent of id order', () => {
        expect(queryKeys.collections.membership(['b', 'a', 'c'])).toEqual(
            queryKeys.collections.membership(['a', 'c', 'b'])
        );
    });

    it('still distinguishes different selections', () => {
        expect(queryKeys.collections.membership(['a', 'b'])).not.toEqual(
            queryKeys.collections.membership(['a', 'c'])
        );
    });
});
