import type { MediaType } from './media';

export interface DecisionResult {
    approved: number;
    skipped: number;
}

export type CollectionEventType =
    | 'UPLOADED'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'REMOVED'
    | 'ITEMS_ADDED'
    | 'ITEMS_REMOVED'
    | 'RENAMED'
    | 'LINK_CREATED'
    | 'LINK_REVOKED';

export type CollectionEventActor = 'OWNER' | 'GUEST' | 'SYSTEM';

/** Where an upload entry's files stand in the owner's review. */
export interface ReviewSummary {
    pending: number;
    approved: number;
    /** Denied, or deleted after the fact. */
    declined: number;
}

/** One entry in an album's change log. */
export interface CollectionEvent {
    id: string;
    collectionId: string;
    type: CollectionEventType;
    actor: CollectionEventActor;
    shareLinkId: string | null;
    contributorName: string | null;
    detail: Record<string, unknown> | null;
    /** Set on an entry that reversed an earlier one. */
    undoOfId: string | null;
    undoneAt: string | null;
    createdAt: string;
    updatedAt: string;
    /** How many items the entry covers; the id lists below are only a preview. */
    itemCount: number;
    mediaItemIds: string[];
    contributionIds: string[];
    undoable: boolean;
    /** On upload entries only. */
    review: ReviewSummary | null;
    shareLink: { id: string; slug: string; label: string | null; isActive: boolean } | null;
}

/** An entry as a guest sees it through a share link. */
export interface PublicCollectionEvent {
    id: string;
    type: Extract<CollectionEventType, 'UPLOADED' | 'ITEMS_ADDED' | 'ITEMS_REMOVED' | 'RENAMED'>;
    actor: CollectionEventActor;
    createdAt: string;
    itemCount: number;
    mediaItemIds: string[];
    detail: Record<string, unknown> | null;
}

export type ReviewState = 'pending' | 'approved' | 'denied' | 'removed';

/** One file in an upload entry, as its review modal shows it. */
export interface EventUpload {
    id: string;
    fileName: string;
    mimeType: string;
    /** Decimal string; the column is a BigInt. */
    fileSize: string;
    state: ReviewState;
    /** Null once the item is gone. */
    mediaItemId: string | null;
    type: MediaType | null;
    thumbnailKey: string | null;
}

export interface UndoResult {
    undone: string[];
    skipped: string[];
}

export interface PurgeLinkResult {
    rejected: number;
    removed: number;
    revoked: boolean;
}
