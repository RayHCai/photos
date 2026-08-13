'use client';

import { useMemo, useState, useCallback } from 'react';
import { useShellData } from '@/lib/hooks/useShellData';
import { useMediaSelection } from '@/lib/hooks/useMediaSelection';
import { useFilePicker } from '@/lib/hooks/useFilePicker';
import { useSearch } from '@/lib/hooks/useSearch';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { useHidden } from '@/lib/hooks/useHidden';
import { useAppMutation } from '@/lib/hooks/useAppMutation';
import { PhotoGallery } from '@/components/gallery/PhotoGallery';
import { SelectionToolbar } from '@/components/gallery/SelectionToolbar';
import { SearchInput } from '@/components/ui/SearchInput';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { batchDeleteMedia } from '@/lib/api/media';
import { batchRetry } from '@/lib/api/jobs';
import { FileDropZone } from '@/components/upload/UploadDropzone';
import { UploadMenu } from '@/components/upload/UploadMenu';
import { pluralize } from '@/lib/utils/pluralize';
import { searchResultToShellItem } from '@/lib/utils/searchResults';
import type { MediaShellItem } from '@/lib/types/media';

export default function GalleryPage() {
    const { items: shellItems, isLoading } = useShellData();
    const [search, setSearch] = useState('');
    const selection = useMediaSelection();
    const { openFilePicker, openFolderPicker } = useFilePicker();
    const { favoriteIds, toggleFavorite } = useFavorites();
    const { hideItems } = useHidden();

    const { data: searchData, isLoading: isSearching } = useSearch(search);
    useEscapeKey(selection.clearSelection, selection.isSelecting);

    /**
     * These previously hand-rolled try/catch + toast +
     * `invalidateQueries(['media'])`. That key does not prefix-match
     * `['collections', id]`, `['persons', …]` or `['search', …]`, so a deleted photo
     * stayed on screen in all of those views until a hard reload. useAppMutation
     * derives the full invalidation set from the declared effects.
     */
    const deleteMutation = useAppMutation({
        mutationFn: (ids: string[]) => batchDeleteMedia(ids),
        effects: ['media-set'],
        successMessage: (_data, ids) => `Deleted ${pluralize(ids.length, 'item')}`,
        errorMessage: 'Failed to delete',
    });

    const retryMutation = useAppMutation({
        mutationFn: (ids: string[]) => batchRetry(ids),
        effects: ['media-content'],
        successMessage: (data) => `Retrying ${pluralize(data.count, 'item')}`,
        errorMessage: 'Failed to retry',
    });

    const handleToggleFavorite = useCallback((id: string) => toggleFavorite(id), [toggleFavorite]);

    // useSystemCollection reports its own success/failure and rolls back on error.
    const handleHide = useCallback((ids: string[]) => hideItems(ids), [hideItems]);

    /**
     * Search results projected into the gallery's item shape.
     *
     * This used to fabricate the fields the endpoint did not return:
     * `processingStatus: 'COMPLETED'` (so a still-processing match rendered as a
     * clickable tile that opened a permanent spinner) and
     * `createdAt: takenAt || new Date()` (so a taken_at-null match was filed under
     * "Today" in search but under its real upload date in the timeline). The endpoint
     * now returns both, and the projection is shared with the other search surfaces.
     */
    const searchItems = useMemo<MediaShellItem[]>(
        () => (searchData?.items ?? []).map(searchResultToShellItem),
        [searchData]
    );

    const isSearchActive = search.trim().length > 0;

    return (
        <FileDropZone className="h-[100dvh] flex flex-col">
            <div className="relative flex items-center justify-center gap-2 px-[30px] pt-5 sm:pt-3 pb-9">
                <div className="sm:flex-1 flex sm:justify-center">
                    <SearchInput value={search} onChange={setSearch} placeholder="Search photos" />
                </div>
                <SelectionToolbar
                    selection={selection}
                    onDelete={deleteMutation.mutate}
                    showAddToCollection
                    showShare
                    showDownload
                    showRetry
                    showHide
                    onHide={handleHide}
                    onRetry={retryMutation.mutate}
                />
                <UploadMenu
                    onUploadFiles={() => openFilePicker()}
                    onUploadFolder={() => openFolderPicker()}
                />
            </div>

            {/* A render error in the grid used to blank the entire app. */}
            <ErrorBoundary label="gallery">
                <PhotoGallery
                    items={isSearchActive ? searchItems : shellItems}
                    isLoading={isSearchActive ? isSearching : isLoading}
                    selection={selection}
                    favoriteIds={favoriteIds}
                    onToggleFavorite={handleToggleFavorite}
                    emptyMessage={isSearchActive ? 'No results found' : undefined}
                />
            </ErrorBoundary>
        </FileDropZone>
    );
}
