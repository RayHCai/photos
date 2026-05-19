'use client';

import { useMemo, useState, useCallback } from 'react';
import { useMediaList } from '@/lib/hooks/useMediaList';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useFileUpload } from '@/lib/hooks/useFileUpload';
import { useSearch } from '@/lib/hooks/useSearch';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { SearchInput } from '@/components/ui/SearchInput';
import { batchDeleteMedia } from '@/lib/api/media';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from 'sonner';
import type { MediaListItem } from '@/lib/types/media';

export default function GalleryPage() {
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
        useMediaList();
    const [search, setSearch] = useState('');
    const selection = useMediaSelection();
    const queryClient = useQueryClient();
    const { openFilePicker } = useFileUpload();

    const { data: searchData, isLoading: isSearching } = useSearch(search);

    const handleBatchDelete = useCallback(async (ids: string[]) => {
        try {
            await batchDeleteMedia(ids);
            queryClient.invalidateQueries({ queryKey: ['media'] });
            toast.success('Deleted');
        }
        catch {
            toast.error('Failed to delete');
        }
    }, [queryClient]);

    const galleryItems = useMemo(
        () => data?.pages.flatMap((p) => p.items) || [],
        [data]
    );

    // Map search results to MediaListItem shape for the gallery
    const searchItems = useMemo((): MediaListItem[] => {
        if (!searchData?.items) return [];
        return searchData.items.map((item) => ({
            id: item.id,
            type: item.type as MediaListItem['type'],
            fileName: '',
            thumbnailKey: item.thumbnailKey,
            width: item.width,
            height: item.height,
            durationSeconds: item.durationSeconds,
            takenAt: item.takenAt,
            processingStatus: 'COMPLETED' as const,
            createdAt: item.takenAt || new Date().toISOString(),
        }));
    }, [searchData]);

    const isSearchActive = search.trim().length > 0;

    return (
        <div className="h-screen flex flex-col">
            {/* Toolbar */}
            <div className="relative flex items-center gap-2 px-[30px] pt-3 pb-9">
                <div className="flex-1 flex justify-center">
                    <SearchInput
                        value={search}
                        onChange={setSearch}
                        placeholder="Search photos"
                    />
                </div>
                <SelectionToolbar
                    selection={selection}
                    onDelete={handleBatchDelete}
                    showAddToCollection
                    showDownload
                />
                <IconButton
                    icon={Plus}
                    onClick={openFilePicker}
                    title="Upload"
                    className="flex-shrink-0"
                />
            </div>

            {/* Gallery — shows search results or full library */}
            <PhotoGallery
                items={isSearchActive ? searchItems : galleryItems}
                isLoading={isSearchActive ? isSearching : isLoading}
                selection={selection}
                hasMore={isSearchActive ? false : hasNextPage}
                fetchMore={() => fetchNextPage()}
                isFetching={isFetchingNextPage}
                emptyMessage={isSearchActive ? 'No results found' : undefined}
            />
        </div>
    );
}
