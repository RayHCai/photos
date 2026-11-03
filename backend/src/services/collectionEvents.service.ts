import type { CollectionEventActor, CollectionEventType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { summarizeReviews } from './contributions.service.js';
import { applyCursor, paginateResults } from '../utils/db.js';
import {
    COALESCED_EVENT_TYPES,
    EVENT_COALESCE_GAP_MS,
    isItemEventType,
    isUndoableEventType,
} from '../constants/collectionEvents.js';

export interface EventInput {
    collectionId: string;
    type: CollectionEventType;
    actor: CollectionEventActor;
    shareLinkId?: string | null;
    contributorName?: string | null;
    mediaItemIds?: string[];
    contributionIds?: string[];
    detail?: Prisma.InputJsonValue;
    /** The entry this one reverses. */
    undoOfId?: string;
}

/**
 * Only the owner's own albums keep a change log. Favourites, hidden and person
 * albums are the app's bookkeeping, and logging every star toggle would be noise
 * nobody reads.
 */
async function keepsChangeLog(tx: Prisma.TransactionClient, collectionId: string) {
    const collection = await tx.collection.findUnique({
        where: { id: collectionId },
        select: { systemType: true, personId: true },
    });
    return !!collection && collection.systemType === null && collection.personId === null;
}

/**
 * Append to an album's change log.
 *
 * Best-effort: the change being described has already happened by the time this
 * runs, so a failure here is logged rather than thrown — failing the request
 * would report an add or an approval as failed when it was not.
 *
 * Uploads and adds coalesce: a run from the same actor through the same link is
 * folded into its latest entry while the gaps stay under EVENT_COALESCE_GAP_MS.
 * The advisory lock serialises that read-then-write per album, so two files
 * confirming at once cannot both decide to start a new entry.
 */
export async function recordEvent(input: EventInput): Promise<void> {
    const mediaItemIds = input.mediaItemIds ?? [];
    const contributionIds = input.contributionIds ?? [];
    if (isItemEventType(input.type) && mediaItemIds.length === 0 && contributionIds.length === 0) {
        return;
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (!(await keepsChangeLog(tx, input.collectionId))) return;

            if (COALESCED_EVENT_TYPES.includes(input.type) && !input.undoOfId) {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`collection-events:${input.collectionId}`}))`;

                const run = await tx.collectionEvent.findFirst({
                    where: {
                        collectionId: input.collectionId,
                        type: input.type,
                        actor: input.actor,
                        shareLinkId: input.shareLinkId ?? null,
                        contributorName: input.contributorName ?? null,
                        undoOfId: null,
                        undoneAt: null,
                        updatedAt: { gte: new Date(Date.now() - EVENT_COALESCE_GAP_MS) },
                    },
                    orderBy: { updatedAt: 'desc' },
                    select: { id: true },
                });

                if (run) {
                    await tx.collectionEvent.update({
                        where: { id: run.id },
                        data: {
                            ...(mediaItemIds.length > 0 ? { mediaItemIds: { push: mediaItemIds } } : {}),
                            ...(contributionIds.length > 0 ? { contributionIds: { push: contributionIds } } : {}),
                        },
                    });
                    return;
                }
            }

            await tx.collectionEvent.create({
                data: {
                    collectionId: input.collectionId,
                    type: input.type,
                    actor: input.actor,
                    shareLinkId: input.shareLinkId ?? null,
                    contributorName: input.contributorName ?? null,
                    mediaItemIds,
                    contributionIds,
                    ...(input.detail !== undefined ? { detail: input.detail } : {}),
                    ...(input.undoOfId ? { undoOfId: input.undoOfId } : {}),
                },
            });
        });
    }
    catch (err) {
        logger.error(
            { err, collectionId: input.collectionId, type: input.type },
            'collection events: failed to record'
        );
    }
}

export async function markUndone(eventId: string): Promise<void> {
    await prisma.collectionEvent.update({
        where: { id: eventId },
        data: { undoneAt: new Date() },
    });
}

/** Ids shown per entry; the full sets can run to hundreds. */
const PREVIEW_IDS = 6;
const EVENTS_PAGE_SIZE = 50;

/** One page of an album's change log, newest first. */
async function pageOfEvents(
    collectionId: string,
    opts: { cursor?: string; limit?: number },
    types?: CollectionEventType[]
) {
    const limit = Math.min(opts.limit ?? EVENTS_PAGE_SIZE, 100);
    const rows = await prisma.collectionEvent.findMany({
        where: { collectionId, ...(types ? { type: { in: types } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...applyCursor(opts.cursor),
        include: {
            shareLink: { select: { id: true, slug: true, label: true, isActive: true } },
        },
    });
    return paginateResults(rows, limit);
}

/**
 * The owner's view of an album's change log. An upload entry carries where its
 * files stand in review, which is what the log's status marks show.
 */
export async function listEvents(collectionId: string, opts: { cursor?: string; limit?: number } = {}) {
    const { items, nextCursor, hasMore } = await pageOfEvents(collectionId, opts);

    const reviews = await summarizeReviews(
        new Map(items.filter((e) => e.type === 'UPLOADED').map((e) => [e.id, e.contributionIds]))
    );

    return {
        items: items.map(({ mediaItemIds, contributionIds, ...event }) => ({
            ...event,
            itemCount: Math.max(mediaItemIds.length, contributionIds.length),
            mediaItemIds: mediaItemIds.slice(0, PREVIEW_IDS),
            contributionIds: contributionIds.slice(0, PREVIEW_IDS),
            undoable: event.undoneAt === null && isUndoableEventType(event.type),
            review: reviews.get(event.id) ?? null,
        })),
        nextCursor,
        hasMore,
    };
}

/**
 * What a guest sees of the change log through a share link: what was added to
 * the album, taken out of it, and what it was called. Nothing about links, the
 * owner's review decisions, or who uploaded through which link.
 */
const PUBLIC_EVENT_TYPES: CollectionEventType[] = ['UPLOADED', 'ITEMS_ADDED', 'ITEMS_REMOVED', 'RENAMED'];

export async function listPublicEvents(collectionId: string, opts: { cursor?: string; limit?: number } = {}) {
    const { items, nextCursor, hasMore } = await pageOfEvents(collectionId, opts, PUBLIC_EVENT_TYPES);

    return {
        items: items.map((event) => ({
            id: event.id,
            type: event.type,
            actor: event.actor,
            createdAt: event.createdAt,
            itemCount: Math.max(event.mediaItemIds.length, event.contributionIds.length),
            // Thumbnails only for what was added; a removed item is not in the album
            // for the link to show.
            mediaItemIds: event.type === 'ITEMS_REMOVED' ? [] : event.mediaItemIds.slice(0, PREVIEW_IDS),
            detail: event.type === 'RENAMED' ? event.detail : null,
        })),
        nextCursor,
        hasMore,
    };
}
