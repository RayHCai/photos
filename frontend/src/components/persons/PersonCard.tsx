'use client';

import { User, Check } from 'lucide-react';
import { personAvatarUrl } from '@/lib/api/persons';
import type { Person } from '@/lib/types/persons';

interface PersonCardProps {
    person: Person;
    onClick: () => void;
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
}

export function PersonCard({ person, onClick, isSelected, isSelecting, onSelect }: PersonCardProps) {
    const handleClick = (e: React.MouseEvent) => {
        if (isSelecting && onSelect) {
            e.preventDefault();
            onSelect(e);
        }
        else {
            onClick();
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (onSelect) {
            e.preventDefault();
            onSelect(e);
        }
    };

    return (
        <button
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className="group flex flex-col items-center gap-2 p-4 rounded hover:bg-stone-100 transition-colors relative select-none"
        >
            <div className="w-20 h-20 rounded-full bg-stone-200 flex items-center justify-center overflow-hidden">
                {person.avatarKey ? (
                    <img
                        src={personAvatarUrl(person.id)}
                        alt={person.name || ''}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <User className="w-8 h-8 text-stone-400" />
                )}
            </div>
            <div className="text-center">
                <p className="text-sm font-serif text-stone-900 truncate max-w-[120px]">
                    {person.name || 'Unknown'}
                </p>
                <p className="text-xs text-stone-500">
                    {person._count.faces} photo
                    {person._count.faces !== 1 ? 's' : ''}
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
        </button>
    );
}
