'use client';

import type { ReactNode } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';

interface ActivityDrawerProps {
    open: boolean;
    onClose: () => void;
    /** False while something opened from the drawer owns Escape. */
    escapeEnabled?: boolean;
    isLoading: boolean;
    isEmpty: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
    /** The entries, as list items. */
    children: ReactNode;
}

/**
 * The change log's drawer: the owner's in an album and a guest's on a share
 * link. Only the entries differ.
 */
export function ActivityDrawer({
    open,
    onClose,
    escapeEnabled = true,
    isLoading,
    isEmpty,
    hasMore,
    isLoadingMore,
    onLoadMore,
    children,
}: ActivityDrawerProps) {
    useEscapeKey(onClose, open && escapeEnabled);

    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/10 sm:bg-transparent" onClick={onClose} aria-hidden="true" />
            <aside
                className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[400px] bg-stone-50 border-l border-stone-200 shadow-2xl shadow-black/10 flex flex-col"
                aria-label="Album activity"
            >
                <div className="flex items-center justify-between px-5 pt-4 pb-3">
                    <h2 className="text-lg font-serif text-stone-900">Activity</h2>
                    <IconButton icon={X} variant="surface" onClick={onClose} title="Close" />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto border-t border-stone-200/70">
                    {isLoading ? (
                        <div className="flex justify-center py-10">
                            <Spinner className="w-6 h-6" />
                        </div>
                    ) : isEmpty ? (
                        <p className="px-5 py-10 text-center text-sm font-serif text-stone-400">No changes yet</p>
                    ) : (
                        <ul className="divide-y divide-stone-200/70">{children}</ul>
                    )}
                    {hasMore && (
                        <div className="flex justify-center py-4">
                            <Button variant="secondary" size="sm" loading={isLoadingMore} onClick={onLoadMore}>
                                Load older
                            </Button>
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}

export function EventTime({ at }: { at: string }) {
    const date = new Date(at);
    return (
        <time dateTime={at} title={format(date, 'PPpp')}>
            {formatDistanceToNow(date, { addSuffix: true })}
        </time>
    );
}

/** The first few items an entry covers, and how many more there are. */
export function EventThumbnails({ srcs, total }: { srcs: string[]; total: number }) {
    if (srcs.length === 0) return null;
    return (
        <div className="flex gap-1 mt-2">
            {srcs.map((src) => (
                <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 object-cover bg-stone-200 rounded-sm"
                    // Items deleted since, or denied uploads, have nothing left to show.
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            ))}
            {total > srcs.length && (
                <span className="w-10 h-10 flex items-center justify-center text-[11px] text-stone-500 bg-stone-200/70 rounded-sm">
                    +{total - srcs.length}
                </span>
            )}
        </div>
    );
}
