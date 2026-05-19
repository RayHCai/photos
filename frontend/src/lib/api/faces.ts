import { apiFetch, apiUrl } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { Face } from '../types/persons';

export function listUnassignedFaces(params: {
    cursor?: string;
    limit?: number;
}): Promise<CursorPaginatedResponse<Face>> {
    const sp = new URLSearchParams();
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.limit) sp.set('limit', String(params.limit));
    return apiFetch(`/faces?${sp}`);
}

export function assignFace(
    faceId: string,
    personId: string
): Promise<Face> {
    return apiFetch(`/faces/${faceId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ personId }),
    });
}

export function unassignFace(faceId: string): Promise<Face> {
    return apiFetch(`/faces/${faceId}/unassign`, { method: 'PATCH' });
}

export function faceCropUrl(faceId: string): string {
    return apiUrl(`/faces/${faceId}/crop`);
}
