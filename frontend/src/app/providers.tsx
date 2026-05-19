'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/providers/AuthProvider';
import { UploadProvider } from '@/lib/providers/UploadProvider';

export function Providers({ children }: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30 * 1000,
                        retry: 1,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <UploadProvider>
                    {children}
                    <Toaster
                        position="top-right"
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
                </UploadProvider>
            </AuthProvider>
        </QueryClientProvider>
    );
}
