'use client';

import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { UploadProgress } from '@/components/upload/UploadProgress';
import { UploadDropzone } from '@/components/upload/UploadDropzone';

export function AppShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen bg-stone-50">
            <Sidebar />
            <main className="min-h-screen">
                {children}
            </main>
            <UploadDropzone />
            <UploadProgress />
        </div>
    );
}
