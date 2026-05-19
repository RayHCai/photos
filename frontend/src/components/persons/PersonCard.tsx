'use client';

import { User } from 'lucide-react';
import { personAvatarUrl } from '@/lib/api/persons';
import type { Person } from '@/lib/types/persons';

interface PersonCardProps {
    person: Person;
    onClick: () => void;
}

export function PersonCard({ person, onClick }: PersonCardProps) {
    return (
        <button
            onClick={onClick}
            className="flex flex-col items-center gap-2 p-4 rounded hover:bg-stone-100 transition-colors"
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
        </button>
    );
}
