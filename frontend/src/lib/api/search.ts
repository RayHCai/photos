import { apiFetch, buildQueryString } from './client';
import type { SearchResponse } from '../types/search';
import type { MediaType } from '../types/media';

export function search(params: {
    q: string;
    page?: number;
    limit?: number;
    type?: MediaType;
}): Promise<SearchResponse> {
    const qs = buildQueryString(params);
    return apiFetch(`/search?${qs}`);
}
