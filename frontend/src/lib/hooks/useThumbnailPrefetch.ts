'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBatchThumbnailUrls } from '../api/media';
import type { VirtualRow } from '@/components/gallery/GalleryGrid';
import type { Virtualizer } from '@tanstack/react-virtual';

export function useThumbnailPrefetch(
    virtualRows: VirtualRow[],
    virtualizer: Virtualizer<HTMLDivElement, Element>,
    enabled: boolean = true
) {
    const cache = useRef(new Map<string, string>());
    const pending = useRef(new Set<string>());
    const [version, setVersion] = useState(0);

    const thumbnailSrcFn = useCallback(
        (id: string): string | undefined => cache.current.get(id),
        [version]
    );

    useEffect(() => {
        if (!enabled || virtualRows.length === 0) return;

        const range = virtualizer.range;
        if (!range) return;

        const timeoutId = setTimeout(() => {
            const startIdx = Math.max(0, range.startIndex - 20);
            const endIdx = Math.min(virtualRows.length - 1, range.endIndex + 20);

            const ids: string[] = [];
            for (let i = startIdx; i <= endIdx; i++) {
                const row = virtualRows[i];
                if (row.type === 'gallery-row' && row.rowData) {
                    for (const item of row.rowData.row.items) {
                        if (!cache.current.has(item.id) && !pending.current.has(item.id)) {
                            ids.push(item.id);
                        }
                    }
                }
            }

            if (ids.length === 0) return;

            for (const id of ids) pending.current.add(id);

            getBatchThumbnailUrls(ids).then((urls) => {
                let added = false;
                for (const [id, url] of Object.entries(urls)) {
                    if (url) {
                        cache.current.set(id, url);
                        added = true;
                    }
                    pending.current.delete(id);
                }
                if (added) setVersion((v) => v + 1);
            }).catch(() => {
                for (const id of ids) pending.current.delete(id);
            });
        }, 150);

        return () => clearTimeout(timeoutId);
    }, [enabled, virtualRows, virtualizer.range?.startIndex, virtualizer.range?.endIndex]);

    return thumbnailSrcFn;
}
