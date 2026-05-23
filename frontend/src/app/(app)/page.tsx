'use client';

import { useMemo, useState, useCallback } from 'react';
import { useShellData } from '@/lib/hooks/useShellData';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useFilePicker } from '@/lib/hooks/useFilePicker';
import { useSearch } from '@/lib/hooks/useSearch';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { useHidden } from '@/lib/hooks/useHidden';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { SearchInput } from '@/components/ui/SearchInput';
import { batchDeleteMedia } from '@/lib/api/media';
import { batchRetry } from '@/lib/api/jobs';
import { useQueryClient } from '@tanstack/react-query';
import { FileDropZone } from '@/components/upload/UploadDropzone';
import { UploadMenu } from '@/components/upload/UploadMenu';
import { pluralize } from '@/lib/utils/pluralize';
import { toast } from 'sonner';
import type { MediaShellItem } from '@/lib/types/media';

export default function GalleryPage() {
    const { data: shellData, isLoading } = useShellData();
    const [search, setSearch] = useState('');
    const selection = useMediaSelection();
    const queryClient = useQueryClient();
    const { openFilePicker, openFolderPicker } = useFilePicker();
    const { favoriteIds, addToFavorites, removeFromFavorites } = useFavorites();
    const { hideItems } = useHidden();

    const handleToggleFavorite = useCallback((id: string, isFavorite: boolean) => {
        if (isFavorite) {
            removeFromFavorites([id]);
        } else {
            addToFavorites([id]);
        }
    }, [addToFavorites, removeFromFavorites]);

    const { data: searchData, isLoading: isSearching } = useSearch(search);
    useEscapeKey(selection.clearSelection, selection.isSelecting);

    const handleHide = useCallback(async (ids: string[]) => {
        try {
            await hideItems(ids);
            toast.success(`${pluralize(ids.length, 'item')} hidden`);
        } catch {
            toast.error('Failed to hide items');
        }
    }, [hideItems]);

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

    const handleBatchRetry = useCallback(async (ids: string[]) => {
        try {
            const { count } = await batchRetry(ids);
            queryClient.invalidateQueries({ queryKey: ['media'] });
            toast.success(`Retrying ${pluralize(count, 'item')}`);
        }
        catch {
            toast.error('Failed to retry');
        }
    }, [queryClient]);

    // Map search results to MediaShellItem shape for the gallery
    const searchItems = useMemo((): MediaShellItem[] => {
        if (!searchData?.items) return [];
        return searchData.items.map((item) => ({
            id: item.id,
            type: item.type as MediaShellItem['type'],
            thumbnailKey: item.thumbnailKey,
            blurHash: item.blurHash ?? null,
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
        <FileDropZone className="h-screen flex flex-col">
            {/* Toolbar */}
            <div className="relative flex items-center justify-center gap-2 px-[30px] pt-5 sm:pt-3 pb-9">
                <div className="sm:flex-1 flex sm:justify-center">
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
                    showRetry
                    showHide
                    onHide={handleHide}
                    onRetry={handleBatchRetry}
                />
                <UploadMenu
                    onUploadFiles={() => openFilePicker()}
                    onUploadFolder={() => openFolderPicker()}
                />
            </div>

            {/* Gallery — shows search results or full library */}
            <PhotoGallery
                items={isSearchActive ? searchItems : (shellData ?? [])}
                isLoading={isSearchActive ? isSearching : isLoading}
                selection={selection}
                favoriteIds={favoriteIds}
                onToggleFavorite={handleToggleFavorite}
                emptyMessage={isSearchActive ? 'No results found' : undefined}
            />
        </FileDropZone>
    );
}
