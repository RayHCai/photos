import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { isUndoableEventType } from '../constants/collectionEvents.js';
import * as collectionsService from './collections.service.js';
import * as shareService from './share.service.js';
import { markUndone } from './collectionEvents.service.js';

export interface UndoResult {
    undone: string[];
    skipped: string[];
}

/**
 * Reverse change-log entries, newest first.
 *
 * Order matters when entries touch the same items: undoing "removed X" and then
 * an earlier "added X" must end with X out of the album, as it was before both.
 *
 * Each reversal is recorded as its own entry pointing back at the original
 * (`undoOfId`), so the log shows the undo happening, and the reversal can in turn
 * be undone. An entry whose reversal fails is left as it was and reported as
 * skipped; the rest still go through.
 */
export async function undoEvents(collectionId: string, eventIds: string[]): Promise<UndoResult> {
    const events = await prisma.collectionEvent.findMany({
        where: { id: { in: eventIds }, collectionId, undoneAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const undone: string[] = [];
    const skipped = eventIds.filter((id) => !events.some((e) => e.id === id));

    for (const event of events) {
        if (!isUndoableEventType(event.type)) {
            skipped.push(event.id);
            continue;
        }

        const opts = { undoOfId: event.id };
        try {
            switch (event.type) {
            case 'ITEMS_ADDED':
                await collectionsService.removeItems(collectionId, event.mediaItemIds, opts);
                break;
            case 'ITEMS_REMOVED':
                await collectionsService.addItems(collectionId, event.mediaItemIds, opts);
                break;
            case 'RENAMED': {
                const from = (event.detail as { from?: unknown } | null)?.from;
                if (typeof from !== 'string') {
                    skipped.push(event.id);
                    continue;
                }
                await collectionsService.updateCollection(collectionId, { name: from }, opts);
                break;
            }
            case 'LINK_CREATED':
                if (event.shareLinkId) await shareService.revokeShareLink(event.shareLinkId, opts);
                break;
            default:
                skipped.push(event.id);
                continue;
            }

            await markUndone(event.id);
            undone.push(event.id);
        }
        catch (err) {
            logger.error({ err, eventId: event.id, type: event.type }, 'collection undo: failed');
            skipped.push(event.id);
        }
    }

    logger.info({ collectionId, undone: undone.length, skipped: skipped.length }, 'collection undo');
    return { undone, skipped };
}
