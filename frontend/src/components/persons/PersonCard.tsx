'use client';

import { User } from 'lucide-react';
import { personAvatarUrl } from '@/lib/api/persons';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useSelectableItem } from '@/lib/hooks/useSelectableItem';
import { pluralize } from '@/lib/utils/pluralize';
import type { Person } from '@/lib/types/persons';

interface PersonCardProps {
    person: Person;
    onClick: () => void;
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
}

export function PersonCard({ person, onClick, isSelected, isSelecting, onSelect }: PersonCardProps) {
    const { handleClick, handleContextMenu } = useSelectableItem({ isSelecting, onSelect, onClick });

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
                    {pluralize(person._count.faces, 'photo')}
                </p>
            </div>

            {onSelect && (
                <SelectionCheckbox isSelected={isSelected} isSelecting={isSelecting} onSelect={onSelect} />
            )}
        </button>
    );
}
