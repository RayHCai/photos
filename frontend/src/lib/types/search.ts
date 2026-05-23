import type { MediaShellItem } from './media';

export interface SearchResult extends Pick<
    MediaShellItem,
    'id' | 'type' | 'thumbnailKey' | 'blurHash' | 'width' | 'height' | 'durationSeconds' | 'takenAt'
> {
    similarity?: number;
    rank?: number;
}

export interface SearchResponse {
    items: SearchResult[];
    total: number;
    page: number;
    limit: number;
    searchType: 'filter' | 'fts' | 'semantic' | 'hybrid';
}
