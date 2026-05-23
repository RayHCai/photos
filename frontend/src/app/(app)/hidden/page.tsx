'use client';

import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useHidden } from '@/lib/hooks/useHidden';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { IconButton } from '@/components/ui/IconButton';
import { pluralize } from '@/lib/utils/pluralize';
import { toast } from 'sonner';
import * as collectionsApi from '@/lib/api/collections';
import type { MediaShellItem } from '@/lib/types/media';

export default function HiddenPage() {
    const { data: hiddenCollection, isLoading } = useQuery({
        queryKey: ['collections', 'hidden'],
        queryFn: collectionsApi.getHiddenCollection,
    });

    const { unhideItems } = useHidden();
    const selection = useMediaSelection();
    useEscapeKey(selection.clearSelection, selection.isSelecting);

    const mediaItems = useMemo((): MediaShellItem[] => {
        if (!hiddenCollection?.items) return [];
        return hiddenCollection.items.map((i) => i.mediaItem);
    }, [hiddenCollection]);

    const handleUnhide = useCallback(async (ids: string[]) => {
        try {
            await unhideItems(ids);
            toast.success(`${pluralize(ids.length, 'item')} unhidden`);
        } catch {
            toast.error('Failed to unhide items');
        }
    }, [unhideItems]);

    return (
        <div className="h-screen flex flex-col">
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
            />
        </div>
    );
}
