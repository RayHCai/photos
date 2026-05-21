'use client';

import { Check } from 'lucide-react';

interface SelectionCheckboxProps {
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect: (e: React.MouseEvent) => void;
}

export function SelectionCheckbox({ isSelected, isSelecting, onSelect }: SelectionCheckboxProps) {
    return (
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
    );
}
