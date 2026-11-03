'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { useSourceAttribution } from '@/lib/providers/SourceAttributionProvider';

interface SourceMarkerProps {
    collectionId: string;
}

/**
 * The bottom-left badge on an item a guest uploaded through a shared album.
 * Hovering widens it to show the album's name; clicking opens the album.
 *
 * Renders nothing outside the authenticated shell (no provider), inside the
 * album the item came from, and once that album no longer exists.
 */
export function SourceMarker({ collectionId }: SourceMarkerProps) {
    const router = useRouter();
    const attribution = useSourceAttribution();
    const request = attribution?.request;

    useEffect(() => {
        request?.();
    }, [request]);

    if (!attribution || attribution.currentCollectionId === collectionId) return null;
    const name = attribution.nameFor(collectionId);
    if (!name) return null;

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                router.push(`/collections/${collectionId}`);
            }}
            // Long-press on touch starts a drag-select; the badge must not eat it.
            onContextMenu={(e) => e.stopPropagation()}
            className="group/source absolute bottom-1 left-1 flex items-center h-5 max-w-[calc(100%-0.5rem)] rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:bg-black/70 focus-visible:outline-none"
            title={`From ${name}`}
            aria-label={`Uploaded to ${name}. Open album`}
        >
            <span className="flex items-center justify-center w-5 h-5 flex-shrink-0">
                <Users className="w-3 h-3" aria-hidden="true" />
            </span>
            <span className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium transition-[max-width,padding] duration-200 group-hover/source:max-w-[10rem] group-hover/source:pr-2 group-focus-visible/source:max-w-[10rem] group-focus-visible/source:pr-2">
                {name}
            </span>
        </button>
    );
}
