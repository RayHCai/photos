'use client';

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { UploadProgress } from '@/components/upload/UploadProgress';

export function AppShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen bg-stone-50">
            <Sidebar />
            <main className="min-h-screen">
                {children}
            </main>
            <UploadProgress />
        </div>
    );
}
