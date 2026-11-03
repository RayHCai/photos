import type { CollectionEventType } from '@prisma/client';

/**
 * Change-log entries that can be reversed, and what reversing each one does:
 *
 * - ITEMS_ADDED / ITEMS_REMOVED: the opposite membership change.
 * - RENAMED: the previous name.
 * - LINK_CREATED: revokes the link.
 *
 * A guest's upload is not undone but reviewed, file by file, from its entry.
 * The rest cannot be: a denied or removed upload's bytes are deleted, and
 * re-enabling a revoked link is a decision that should be made on purpose
 * rather than as a side effect of tidying the log.
 */
export const UNDOABLE_EVENT_TYPES: readonly CollectionEventType[] = [
    'ITEMS_ADDED',
    'ITEMS_REMOVED',
    'RENAMED',
    'LINK_CREATED',
];

export function isUndoableEventType(type: CollectionEventType): boolean {
    return UNDOABLE_EVENT_TYPES.includes(type);
}

/** Entries that describe a set of items, and mean nothing when the set is empty. */
const ITEM_EVENT_TYPES: readonly CollectionEventType[] = [
    'UPLOADED',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'REMOVED',
    'ITEMS_ADDED',
    'ITEMS_REMOVED',
];

export function isItemEventType(type: CollectionEventType): boolean {
    return ITEM_EVENT_TYPES.includes(type);
}

/**
 * Entries a run of which folds into one. A guest's upload confirms once per file
 * and the owner's upload into an album adds once per file, so recording each
 * would bury everything else in the log.
 */
export const COALESCED_EVENT_TYPES: readonly CollectionEventType[] = ['UPLOADED', 'ITEMS_ADDED'];

/** How long such a run may pause and still be the same entry. */
export const EVENT_COALESCE_GAP_MS = 5 * 60 * 1000;
