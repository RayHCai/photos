'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/providers/AuthProvider';
import { DownloadProvider } from '@/lib/providers/DownloadProvider';
import { DownloadProgress } from '@/components/download/DownloadProgress';

export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30 * 1000,
                        gcTime: 5 * 60 * 1000,
                        retry: 1,
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <DownloadProvider>
                    {children}
                    <DownloadProgress />
                </DownloadProvider>
            </AuthProvider>
            <Toaster
                position="bottom-right"
                closeButton
                toastOptions={{
                    style: {
                        background: '#fafaf9',
                        border: '1px solid #e7e5e4',
                        color: '#1c1917',
                        fontSize: '13px',
                        padding: '14px 18px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                    },
                }}
            />
        </QueryClientProvider>
    );
}
