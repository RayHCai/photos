'use client';

import { thumbnailUrl } from '@/lib/api/media';
import { Check } from 'lucide-react';

interface ThumbnailGridItem {
    id: string;
    thumbnailKey: string | null;
}

interface ThumbnailGridProps {
    items: ThumbnailGridItem[];
    selectedIds?: Set<string>;
    onItemClick: (id: string, e: React.MouseEvent) => void;
    columns?: string;
    gap?: string;
}

export function ThumbnailGrid({
    items,
    selectedIds,
    onItemClick,
    columns = 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]',
    gap = 'gap-1.5',
}: ThumbnailGridProps) {
    return (
        <div className={`grid ${columns} ${gap}`}>
            {items.map((item) => {
                const isSelected = selectedIds?.has(item.id);
                return (
                    <button
                        key={item.id}
                        className="relative aspect-square rounded overflow-hidden bg-stone-100 hover:ring-1 hover:ring-stone-300 transition-all cursor-pointer"
                        onClick={(e) => onItemClick(item.id, e)}
                    >
                        {item.thumbnailKey ? (
                            <img
                                src={thumbnailUrl(item.id)}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full bg-stone-200" />
                        )}
                        {isSelected && (
                            <div className="absolute inset-0 bg-stone-900/30 flex items-center justify-center">
                                <div className="w-6 h-6 rounded-full bg-stone-900 flex items-center justify-center">
                                    <Check className="w-4 h-4 text-white" />
                                </div>
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
