import { apiFetch } from './client';
import type { SearchResponse } from '../types/search';

export function search(params: {
    q: string;
    page?: number;
    limit?: number;
    type?: 'PHOTO' | 'VIDEO';
}): Promise<SearchResponse> {
    const sp = new URLSearchParams();
    sp.set('q', params.q);
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.type) sp.set('type', params.type);
    return apiFetch(`/search?${sp}`);
}
