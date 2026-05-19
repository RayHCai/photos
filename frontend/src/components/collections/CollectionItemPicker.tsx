'use client';

import { useState, useMemo, useRef } from 'react';
import { useMediaList } from '@/lib/hooks/useMediaList';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { thumbnailUrl } from '@/lib/api/media';
import { Check } from 'lucide-react';

interface CollectionItemPickerProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (ids: string[]) => void;
    loading?: boolean;
    excludeIds?: Set<string>;
}

export function CollectionItemPicker({
    open,
    onClose,
    onConfirm,
    loading,
    excludeIds,
}: CollectionItemPickerProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const lastSelectedIdRef = useRef<string | null>(null);
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useMediaList();

    const items = useMemo(
        () =>
            (data?.pages.flatMap((p) => p.items) || []).filter(
                (i) => !excludeIds?.has(i.id)
            ),
        [data, excludeIds]
    );

    const itemIds = useMemo(() => items.map((i) => i.id), [items]);

    const sentinelRef = useInfiniteScroll(
        () => fetchNextPage(),
        !!hasNextPage && !isFetchingNextPage
    );

    const handleSelect = (id: string, e: React.MouseEvent) => {
        if (e.shiftKey && lastSelectedIdRef.current) {
            const fromIndex = itemIds.indexOf(lastSelectedIdRef.current);
            const toIndex = itemIds.indexOf(id);
            if (fromIndex !== -1 && toIndex !== -1) {
                const start = Math.min(fromIndex, toIndex);
                const end = Math.max(fromIndex, toIndex);
                setSelected((prev) => {
                    const next = new Set(prev);
                    for (let i = start; i <= end; i++) {
                        next.add(itemIds[i]);
                    }
                    return next;
                });
                lastSelectedIdRef.current = id;
                return;
            }
        }
        lastSelectedIdRef.current = id;
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <Dialog open={open} onClose={onClose} title="Add items">
            <div className="max-h-80 overflow-y-auto -mx-6 px-6">
                <div className="grid grid-cols-4 gap-1">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="relative aspect-square cursor-pointer overflow-hidden bg-stone-100 rounded-sm"
                            onClick={(e) => handleSelect(item.id, e)}
                        >
                            {item.thumbnailKey ? (
                                <img
                                    src={thumbnailUrl(item.id)}
                                    alt=""
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full" />
                            )}
                            {selected.has(item.id) && (
                                <div className="absolute inset-0 bg-stone-900/30 flex items-center justify-center">
                                    <div className="w-6 h-6 rounded-full bg-stone-900 flex items-center justify-center">
                                        <Check className="w-4 h-4 text-white" />
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div ref={sentinelRef} className="h-2" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={() => onConfirm(Array.from(selected))}
                    loading={loading}
                    disabled={selected.size === 0}
                >
                    Add {selected.size > 0 ? `(${selected.size})` : ''}
                </Button>
            </div>
        </Dialog>
    );
}
