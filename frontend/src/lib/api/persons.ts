import { apiFetch, apiUrl, buildQueryString } from './client';
import type { CursorPaginatedResponse } from '../types/api';
import type { Person, PersonMediaItem } from '../types/persons';

export function listPersons(): Promise<Person[]> {
    return apiFetch('/persons');
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
    const qs = buildQueryString(params);
    return apiFetch(`/persons/${id}/media?${qs}`);
}

export function personAvatarUrl(id: string): string {
    return apiUrl(`/persons/${id}/avatar`);
}

interface SharePersonResult {
    collection: { id: string; name: string };
    shareLink: { id: string; slug: string; collectionId: string };
    created: boolean;
}

export function sharePerson(id: string): Promise<SharePersonResult> {
    return apiFetch(`/persons/${id}/share`, { method: 'POST' });
}
