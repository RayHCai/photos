import { apiFetch, buildQueryString } from './client';
import type { SearchResponse } from '../types/search';

export function search(params: {
    q: string;
    page?: number;
    limit?: number;
    type?: 'PHOTO' | 'VIDEO';
}): Promise<SearchResponse> {
    const qs = buildQueryString(params);
    return apiFetch(`/search?${qs}`);
}
