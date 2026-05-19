'use client';

import Link from 'next/link';
import { FolderOpen, Check } from 'lucide-react';
import type { Collection } from '@/lib/types/collections';
import { thumbnailUrl } from '@/lib/api/media';

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

    const handleClick = (e: React.MouseEvent) => {
        if (isSelecting && onSelect) {
            e.preventDefault();
            onSelect(e);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (onSelect) {
            e.preventDefault();
            onSelect(e);
        }
    };

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
                    {collection._count.items} item
                    {collection._count.items !== 1 ? 's' : ''}
                </p>
            </div>

            {onSelect && (
                <div
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect(e);
                    }}
                    className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-none border-2 flex items-center justify-center cursor-pointer transition-all ${
                        isSelected
                            ? 'bg-stone-900 border-stone-900'
                            : 'border-white bg-black/20'
                    } ${isSelecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
            )}
        </Link>
    );
}
