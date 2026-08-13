'use client';

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { DuplicateModal } from '@/components/upload/DuplicateModal';
import { useUpload } from '@/lib/hooks/useUpload';

export function AppShell({ children }: { children: ReactNode }) {
    const { pendingDuplicates, resolveDuplicates } = useUpload();

    return (
        <div className="min-h-[100dvh] bg-stone-50">
            <Sidebar />
            <main className="min-h-[100dvh]">
                {children}
            </main>
            {pendingDuplicates.length > 0 && (
                <DuplicateModal
                    duplicates={pendingDuplicates}
                    onResolve={resolveDuplicates}
                />
            )}
        </div>
    );
}
