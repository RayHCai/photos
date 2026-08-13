import type { MediaShellItem } from './media';

/**
 * A single search hit.
 *
 * Now includes `processingStatus`, `createdAt` and `takenAtLocal`, which the client
 * previously had to invent because the endpoint's raw-SQL branches omitted them. See
 * utils/searchResults.ts.
 */
export interface SearchResultItem
    extends Pick<
        MediaShellItem,
        | 'id'
        | 'type'
        | 'thumbnailKey'
        | 'blurHash'
        | 'width'
        | 'height'
        | 'durationSeconds'
        | 'takenAt'
        | 'takenAtLocal'
        | 'processingStatus'
        | 'createdAt'
    > {
    fileName?: string;
    similarity?: number;
    rank?: number;
}

/** @deprecated Use SearchResultItem. Kept so existing imports keep compiling. */
export type SearchResult = SearchResultItem;

export interface SearchResponse {
    items: SearchResultItem[];
    total: number;
    page: number;
    limit: number;
    /**
     * 'hybrid' is not currently produced by any backend path; 'semantic' only when
     * SEMANTIC_SEARCH_ENABLED is on and the worker is reachable. When it is off the
     * backend honestly reports 'fts' rather than claiming semantic results.
     */
    searchType: 'filter' | 'fts' | 'semantic' | 'hybrid';
}
