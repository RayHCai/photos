export interface SearchResult {
    id: string;
    type: 'PHOTO' | 'VIDEO';
    thumbnailKey: string | null;
    blurHash: string | null;
    takenAt: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
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
