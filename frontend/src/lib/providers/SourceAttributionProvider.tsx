'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCollectionNames } from '../api/collections';
import { queryKeys } from '../queries/keys';

interface SourceAttribution {
    /** The album's name, or undefined while loading or once it is gone. */
    nameFor: (collectionId: string) => string | undefined;
    /** Called by a marker as it mounts; the names load only once one does. */
    request: () => void;
    /** The album being viewed, whose own items need no marker saying so. */
    currentCollectionId?: string;
}

const SourceAttributionContext = createContext<SourceAttribution | null>(null);

/**
 * Album names for the gallery's source markers.
 *
 * Fetched lazily: almost every gallery page has no guest uploads in it, and the
 * names cost a request that only a visible marker justifies. Lives in the
 * authenticated shell only, so a public share page never shows the owner's
 * album names.
 */
export function SourceAttributionProvider({ children }: { children: ReactNode }) {
    const [wanted, setWanted] = useState(false);

    const { data } = useQuery({
        queryKey: queryKeys.collections.names(),
        queryFn: getCollectionNames,
        enabled: wanted,
        staleTime: 5 * 60_000,
    });

    const names = useMemo(() => new Map(data?.map((c) => [c.id, c.name])), [data]);
    const request = useCallback(() => setWanted(true), []);
    const nameFor = useCallback((id: string) => names.get(id), [names]);

    const value = useMemo(() => ({ nameFor, request }), [nameFor, request]);
    return (
        <SourceAttributionContext.Provider value={value}>
            {children}
        </SourceAttributionContext.Provider>
    );
}

/** Marks the album being viewed, so its own uploads go unmarked inside it. */
export function SourceAttributionScope({
    currentCollectionId,
    children,
}: {
    currentCollectionId: string;
    children: ReactNode;
}) {
    const parent = useContext(SourceAttributionContext);
    const value = useMemo(
        () => (parent ? { ...parent, currentCollectionId } : null),
        [parent, currentCollectionId]
    );
    return (
        <SourceAttributionContext.Provider value={value}>
            {children}
        </SourceAttributionContext.Provider>
    );
}

export function useSourceAttribution() {
    return useContext(SourceAttributionContext);
}
