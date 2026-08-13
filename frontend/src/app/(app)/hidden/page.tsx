'use client';

import { useCallback } from 'react';
import { Eye } from 'lucide-react';
import { useHidden } from '@/lib/hooks/useHidden';
import { useHiddenCollection } from '@/lib/hooks/useCollections';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { IconButton } from '@/components/ui/IconButton';

export default function HiddenPage() {
    const {
        items: mediaItems,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useHiddenCollection();

    const { unhideItems } = useHidden();
    const selection = useMediaSelection();
    useEscapeKey(selection.clearSelection, selection.isSelecting);

    // useSystemCollection reports success and failure itself (optimistic update
    // plus rollback plus toast), so no local try/catch or toast is needed here.
    const handleUnhide = useCallback((ids: string[]) => {
        unhideItems(ids);
    }, [unhideItems]);

    return (
        <div className="h-[100dvh] flex flex-col">
            <div className="relative flex items-center justify-center gap-2 px-[30px] pt-5 sm:pt-3 pb-9">
                {selection.isSelecting && (
                    <div className="absolute right-[30px] top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 h-9 bg-stone-100 rounded-lg px-2">
                        <span className="text-xs font-medium text-stone-500 tabular-nums mr-0.5">
                            {selection.count} selected
                        </span>
                        <IconButton
                            icon={Eye}
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                                await handleUnhide(Array.from(selection.selectedIds));
                                selection.clearSelection();
                            }}
                            title="Unhide selected"
                        />
                    </div>
                )}
            </div>

            <PhotoGallery
                items={mediaItems}
                isLoading={isLoading}
                selection={selection}
                emptyMessage="No hidden items"
                onLoadMore={fetchNextPage}
                hasMore={hasNextPage}
                isLoadingMore={isFetchingNextPage}
            />
        </div>
    );
}
