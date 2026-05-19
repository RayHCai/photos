import { apiFetch, apiUrl } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { Person, PersonMediaItem } from '../types/persons';

export function listPersons(): Promise<Person[]> {
    return apiFetch('/persons');
}

export function getPerson(id: string): Promise<Person> {
    return apiFetch(`/persons/${id}`);
}

export function renamePerson(
    id: string,
    name: string
): Promise<Person> {
    return apiFetch(`/persons/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
}

export function mergePersons(
    sourceId: string,
    targetId: string
): Promise<Person> {
    return apiFetch('/persons/merge', {
        method: 'POST',
        body: JSON.stringify({ sourceId, targetId }),
    });
}

export function deletePerson(id: string): Promise<void> {
    return apiFetch(`/persons/${id}`, { method: 'DELETE' });
}

export function getPersonMedia(
    id: string,
    params: { cursor?: string; limit?: number }
): Promise<CursorPaginatedResponse<PersonMediaItem>> {
    const sp = new URLSearchParams();
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.limit) sp.set('limit', String(params.limit));
    return apiFetch(`/persons/${id}/media?${sp}`);
}

export function personAvatarUrl(id: string): string {
    return apiUrl(`/persons/${id}/avatar`);
}
