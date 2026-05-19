'use client';

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { UploadProgress } from '@/components/upload/UploadProgress';
import { DuplicateModal } from '@/components/upload/DuplicateModal';
import { useUpload } from '@/lib/hooks/useUpload';

export function AppShell({ children }: { children: ReactNode }) {
    const { pendingDuplicates, resolveDuplicates } = useUpload();

    return (
        <div className="min-h-screen bg-stone-50">
            <Sidebar />
            <main className="min-h-screen">
                {children}
            </main>
            <UploadProgress />
            {pendingDuplicates.length > 0 && (
                <DuplicateModal
                    duplicates={pendingDuplicates}
                    onResolve={resolveDuplicates}
                />
            )}
        </div>
    );
}
