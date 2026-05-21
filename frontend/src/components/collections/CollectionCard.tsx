'use client';

import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import type { Collection } from '@/lib/types/collections';
import { thumbnailUrl } from '@/lib/api/media';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useSelectableItem } from '@/lib/hooks/useSelectableItem';
import { pluralize } from '@/lib/utils/pluralize';

interface CollectionCardProps {
    collection: Collection;
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
}

export function CollectionCard({ collection, isSelected, isSelecting, onSelect }: CollectionCardProps) {
    const hasThumbnail =
        collection.coverItem &&
        collection.coverItem.processingStatus === 'COMPLETED' &&
        collection.coverItem.thumbnailKey;

    const { handleClick, handleContextMenu } = useSelectableItem({ isSelecting, onSelect });

    return (
        <Link
            href={`/collections/${collection.id}`}
            className="group block rounded overflow-hidden bg-stone-100 hover:bg-stone-200 transition-colors relative select-none"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            <div className="aspect-[4/3] bg-stone-200 flex items-center justify-center overflow-hidden">
                {hasThumbnail ? (
                    <img
                        src={thumbnailUrl(collection.coverItem!.id)}
                        alt={collection.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        draggable={false}
                    />
                ) : (
                    <FolderOpen className="w-12 h-12 text-stone-400" />
                )}
            </div>
            <div className="p-3">
                <h3 className="text-sm font-serif text-stone-900 truncate">
                    {collection.name}
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                    {pluralize(collection._count.items, 'item')}
                </p>
            </div>

            {onSelect && (
                <SelectionCheckbox isSelected={isSelected} isSelecting={isSelecting} onSelect={onSelect} />
            )}
        </Link>
    );
}
