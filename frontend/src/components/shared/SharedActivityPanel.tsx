'use client';

import { useMemo } from 'react';
import { FolderMinus, FolderPlus, Pencil, Upload, type LucideIcon } from 'lucide-react';
import { sharedThumbnailUrl } from '@/lib/api/share';
import { useSharedEvents } from '@/lib/hooks/useContributions';
import { pluralize } from '@/lib/utils/pluralize';
import { ActivityDrawer, EventThumbnails, EventTime } from '@/components/collections/ActivityDrawer';
import type { PublicCollectionEvent } from '@/lib/types/contributions';

interface SharedActivityPanelProps {
    slug: string;
    open: boolean;
    onClose: () => void;
}

const EVENT_ICONS: Record<PublicCollectionEvent['type'], LucideIcon> = {
    UPLOADED: Upload,
    ITEMS_ADDED: FolderPlus,
    ITEMS_REMOVED: FolderMinus,
    RENAMED: Pencil,
};

function describeEvent(event: PublicCollectionEvent): string {
    const n = event.itemCount;
    switch (event.type) {
    case 'UPLOADED':
        return `Someone uploaded ${pluralize(n, 'file')}`;
    case 'ITEMS_ADDED':
        return `${pluralize(n, 'item')} added`;
    case 'ITEMS_REMOVED':
        return `${pluralize(n, 'item')} removed`;
    case 'RENAMED':
        return `Album renamed to “${String(event.detail?.to ?? '')}”`;
    }
}

/** The album's change log as a guest sees it: what was added, removed and renamed. */
export function SharedActivityPanel({ slug, open, onClose }: SharedActivityPanelProps) {
    const events = useSharedEvents(slug, open);
    const entries = useMemo(() => events.data?.pages.flatMap((p) => p.items) ?? [], [events.data]);

    return (
        <ActivityDrawer
            open={open}
            onClose={onClose}
            isLoading={events.isLoading}
            isEmpty={entries.length === 0}
            hasMore={events.hasNextPage}
            isLoadingMore={events.isFetchingNextPage}
            onLoadMore={() => events.fetchNextPage()}
        >
            {entries.map((event) => {
                const Icon = EVENT_ICONS[event.type];
                return (
                    <li key={event.id} className="px-5 py-3 flex gap-3">
                        <div className="w-7 h-7 rounded-full bg-stone-200/70 flex items-center justify-center flex-shrink-0">
                            <Icon className="w-3.5 h-3.5 text-stone-600" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-stone-800">{describeEvent(event)}</p>
                            <p className="text-xs text-stone-400 mt-0.5">
                                <EventTime at={event.createdAt} />
                            </p>
                            <EventThumbnails
                                srcs={event.mediaItemIds.map((id) => sharedThumbnailUrl(slug, id))}
                                total={event.itemCount}
                            />
                        </div>
                    </li>
                );
            })}
        </ActivityDrawer>
    );
}
