'use client';

import { Search } from 'lucide-react';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: SearchInputProps) {
    return (
        <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full h-9 pl-9 pr-4 bg-stone-100/80 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:bg-white focus:ring-1 focus:ring-stone-300 transition-all duration-200"
            />
        </div>
    );
}
