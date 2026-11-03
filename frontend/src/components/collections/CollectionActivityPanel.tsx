'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
    Check,
    Clock,
    FolderMinus,
    FolderPlus,
    Link2,
    Link2Off,
    Pencil,
    Trash2,
    Undo2,
    Upload,
    X,
    type LucideIcon,
} from 'lucide-react';
import { thumbnailUrl } from '@/lib/api/media';
import { useCollectionEvents, useUndoCollectionEvents } from '@/lib/hooks/useContributions';
import { pluralize } from '@/lib/utils/pluralize';
import { IconButton } from '@/components/ui/IconButton';
import { ActivityDrawer, EventThumbnails, EventTime } from './ActivityDrawer';
import { EventUploadsModal } from './EventUploadsModal';
import type { CollectionEvent, ReviewSummary } from '@/lib/types/contributions';

interface CollectionActivityPanelProps {
    collectionId: string;
    open: boolean;
    onClose: () => void;
}

const linkName = (link: NonNullable<CollectionEvent['shareLink']>) => link.label || `/s/${link.slug}`;

const EVENT_ICONS: Record<CollectionEvent['type'], LucideIcon> = {
    UPLOADED: Upload,
    APPROVED: Check,
    REJECTED: X,
    EXPIRED: Clock,
    REMOVED: Trash2,
    ITEMS_ADDED: FolderPlus,
    ITEMS_REMOVED: FolderMinus,
    RENAMED: Pencil,
    LINK_CREATED: Link2,
    LINK_REVOKED: Link2Off,
};

/** One sentence for an entry: who did what. The link is shown on its own line. */
function describeEvent(event: CollectionEvent): string {
    const n = event.itemCount;
    const from = event.contributorName ? ` from ${event.contributorName}` : '';

    switch (event.type) {
    case 'UPLOADED':
        return `${event.contributorName ?? 'Someone'} uploaded ${pluralize(n, 'file')}`;
    // The next four are no longer recorded; older logs may still hold them.
    case 'APPROVED':
        return `You approved ${pluralize(n, 'upload')}${from}`;
    case 'REJECTED':
        return `You rejected ${pluralize(n, 'upload')}${from}`;
    case 'EXPIRED':
        return `${pluralize(n, 'unreviewed upload')} expired`;
    case 'REMOVED':
        return `You deleted ${pluralize(n, 'approved upload')}${from} from your library`;
    case 'ITEMS_ADDED':
        return `You added ${pluralize(n, 'item')}`;
    case 'ITEMS_REMOVED':
        return `You removed ${pluralize(n, 'item')}`;
    case 'RENAMED':
        return `You renamed the album from “${String(event.detail?.from ?? '')}” to “${String(event.detail?.to ?? '')}”`;
    case 'LINK_CREATED':
        return 'You created a share link';
    case 'LINK_REVOKED':
        return 'You revoked a share link';
    }
}

/**
 * Where an upload stands: nothing decided (grey), some of it decided (amber),
 * or all of it, with at least one file approved (green) or none (denied).
 */
type ReviewMark = 'unreviewed' | 'partial' | 'approved' | 'denied';

function reviewMark(review: ReviewSummary | null): ReviewMark {
    if (!review) return 'unreviewed';
    if (review.pending === 0) return review.approved > 0 ? 'approved' : 'denied';
    return review.approved + review.declined > 0 ? 'partial' : 'unreviewed';
}

const MARK_STYLES: Record<ReviewMark, { circle: string; icon: LucideIcon; label: string }> = {
    unreviewed: { circle: 'bg-stone-200/70 text-stone-600', icon: Upload, label: 'Not reviewed' },
    partial: { circle: 'bg-amber-100 text-amber-700', icon: Upload, label: 'Partly reviewed' },
    approved: { circle: 'bg-emerald-100 text-emerald-700', icon: Check, label: 'Reviewed' },
    denied: { circle: 'bg-stone-200/70 text-stone-500', icon: X, label: 'Denied' },
};

function describeReview(review: ReviewSummary | null, mark: ReviewMark): string {
    if (!review || mark === 'unreviewed') return 'Waiting for review';
    if (mark === 'denied') return 'Denied';
    const parts = [`${review.approved} approved`];
    if (review.declined > 0) parts.push(`${review.declined} denied`);
    if (review.pending > 0) parts.push(`${review.pending} waiting`);
    return mark === 'approved' && review.declined === 0 ? 'Added to your library' : parts.join(' · ');
}

/**
 * The album's change log, as a drawer: every change, who made it, through which
 * link, and when. A guest's upload is reviewed from its entry; the owner's own
 * changes can be undone one at a time.
 */
export function CollectionActivityPanel({ collectionId, open, onClose }: CollectionActivityPanelProps) {
    const [reviewing, setReviewing] = useState<CollectionEvent | null>(null);

    const events = useCollectionEvents(collectionId, open);
    const undo = useUndoCollectionEvents(collectionId);
    const entries = useMemo(() => events.data?.pages.flatMap((p) => p.items) ?? [], [events.data]);

    return (
        <>
            <ActivityDrawer
                open={open}
                onClose={onClose}
                escapeEnabled={reviewing === null}
                isLoading={events.isLoading}
                isEmpty={entries.length === 0}
                hasMore={events.hasNextPage}
                isLoadingMore={events.isFetchingNextPage}
                onLoadMore={() => events.fetchNextPage()}
            >
                {entries.map((event) =>
                    event.type === 'UPLOADED' ? (
                        <UploadRow key={event.id} event={event} onReview={() => setReviewing(event)} />
                    ) : (
                        <EventRow
                            key={event.id}
                            event={event}
                            onUndo={() => undo.mutate([event.id])}
                            busy={undo.isPending}
                        />
                    )
                )}
            </ActivityDrawer>

            <EventUploadsModal
                collectionId={collectionId}
                event={reviewing}
                onClose={() => setReviewing(null)}
            />
        </>
    );
}

function Meta({ event, children }: { event: CollectionEvent; children?: ReactNode }) {
    return (
        <p className="text-xs text-stone-400 mt-0.5">
            {event.shareLink && <>via {linkName(event.shareLink)} · </>}
            <EventTime at={event.createdAt} />
            {children}
        </p>
    );
}

/** A guest's upload. Opens its files for review while any are still undecided. */
function UploadRow({ event, onReview }: { event: CollectionEvent; onReview: () => void }) {
    const mark = reviewMark(event.review);
    const style = MARK_STYLES[mark];
    const reviewable = mark === 'unreviewed' || mark === 'partial';

    const body = (
        <>
            <span
                className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${style.circle}`}
                title={style.label}
            >
                <style.icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="sr-only">{style.label}</span>
            </span>
            <span className="flex-1 min-w-0 block">
                <span className="block text-sm text-stone-800">{describeEvent(event)}</span>
                <Meta event={event} />
                <span className={`block text-xs mt-0.5 ${mark === 'partial' ? 'text-amber-700' : 'text-stone-500'}`}>
                    {describeReview(event.review, mark)}
                </span>
                <EventThumbnails srcs={event.mediaItemIds.map(thumbnailUrl)} total={event.itemCount} />
            </span>
        </>
    );

    if (!reviewable) return <li className="px-5 py-3 flex gap-3">{body}</li>;

    return (
        <li>
            <button
                type="button"
                onClick={onReview}
                className="w-full px-5 py-3 flex gap-3 text-left hover:bg-stone-100/80 focus-visible:bg-stone-100/80 focus:outline-none transition-colors"
                title="Review these uploads"
            >
                {body}
            </button>
        </li>
    );
}

function EventRow({ event, onUndo, busy }: { event: CollectionEvent; onUndo: () => void; busy: boolean }) {
    const Icon = EVENT_ICONS[event.type];
    const undone = event.undoneAt !== null;
    // A removed upload's item was deleted; anything else may still be there to show.
    const thumbs = event.type === 'REMOVED' ? [] : event.mediaItemIds.map(thumbnailUrl);

    return (
        <li className={`px-5 py-3 flex gap-3 ${undone ? 'opacity-60' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-stone-200/70 flex items-center justify-center flex-shrink-0">
                <Icon className="w-3.5 h-3.5 text-stone-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-sm text-stone-800 ${undone ? 'line-through' : ''}`}>
                    {event.undoOfId && <span className="text-stone-500">Undo: </span>}
                    {describeEvent(event)}
                </p>
                <Meta event={event}>{undone && ' · undone'}</Meta>
                <EventThumbnails srcs={thumbs} total={event.itemCount} />
            </div>
            {event.undoable && (
                <IconButton
                    icon={Undo2}
                    size="sm"
                    variant="surface"
                    disabled={busy}
                    onClick={onUndo}
                    title="Undo"
                    className="self-start"
                />
            )}
        </li>
    );
}
