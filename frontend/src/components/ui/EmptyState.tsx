'use client';

import type { ReactNode } from 'react';

interface EmptyStateProps {
    icon: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-stone-300 mb-4">{icon}</div>
            <h3 className="text-lg font-serif text-stone-900 mb-1">{title}</h3>
            {description && (
                <p className="text-sm text-stone-500 mb-4 max-w-sm">
                    {description}
                </p>
            )}
            {action}
        </div>
    );
}
