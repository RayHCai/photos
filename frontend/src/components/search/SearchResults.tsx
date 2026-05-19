'use client';

import { thumbnailUrl } from '@/lib/api/media';
import { formatDuration } from '@/lib/utils/format';
import { Play, Search } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { SearchResult } from '@/lib/types/search';

interface SearchResultsProps {
    results: SearchResult[];
    searchType: string;
    onItemClick: (id: string) => void;
}

export function SearchResults({
    results,
    searchType,
    onItemClick,
}: SearchResultsProps) {
    if (results.length === 0) {
        return (
            <EmptyState
                icon={<Search className="w-12 h-12" />}
                title="No results found"
                description="Try a different search term"
            />
        );
    }

    return (
        <div>
            <p className="text-xs text-stone-400 px-4 py-2">
                {results.length} result{results.length !== 1 ? 's' : ''} ({searchType})
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-0.5 px-4">
                {results.map((item) => (
                    <div
                        key={item.id}
                        className="relative aspect-square cursor-pointer overflow-hidden bg-stone-100 group"
                        onClick={() => onItemClick(item.id)}
                    >
                        {item.thumbnailKey ? (
                            <img
                                src={thumbnailUrl(item.id)}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                                No preview
                            </div>
                        )}

                        {item.type === 'VIDEO' && (
                            <div className="absolute bottom-1 right-1 flex items-center gap-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-sm">
                                <Play className="w-3 h-3" />
                                {item.durationSeconds !== null &&
                                    formatDuration(item.durationSeconds)}
                            </div>
                        )}

                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                    </div>
                ))}
            </div>
        </div>
    );
}
