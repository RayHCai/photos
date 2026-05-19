'use client';

import { Loader2 } from 'lucide-react';

export function Spinner({ className = '' }: { className?: string }) {
    return (
        <Loader2
            className={`animate-spin text-stone-400 ${className}`}
        />
    );
}
