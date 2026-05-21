'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: SearchInputProps) {
    const [expanded, setExpanded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (expanded && inputRef.current) {
            inputRef.current.focus();
        }
    }, [expanded]);

    const handleClose = () => {
        setExpanded(false);
        onChange('');
    };

    return (
        <>
            {/* Mobile: icon button that expands to full-width overlay input */}
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-100 transition-colors duration-200"
                aria-label="Search"
            >
                <Search className="w-4 h-4 text-stone-500" />
            </button>

            {expanded && (
                <>
                    <div
                        className="sm:hidden fixed inset-0 z-40"
                        onClick={handleClose}
                    />
                    <div className="sm:hidden fixed inset-x-0 top-0 z-50 flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur-lg shadow-sm">
                        <Search className="w-4 h-4 text-stone-400 flex-shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder={placeholder}
                            className="flex-1 h-9 bg-transparent text-sm text-stone-900 placeholder:text-stone-400 outline-none"
                        />
                        <button
                            type="button"
                            onClick={handleClose}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-stone-100 transition-colors duration-200 flex-shrink-0"
                            aria-label="Close search"
                        >
                            <X className="w-4 h-4 text-stone-500" />
                        </button>
                    </div>
                </>
            )}

            {/* Desktop: always-visible inline input */}
            <div className="relative w-full max-w-md hidden sm:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full h-9 pl-9 pr-4 bg-stone-100/80 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:bg-white focus:ring-1 focus:ring-stone-300 transition-all duration-200"
                />
            </div>
        </>
    );
}
