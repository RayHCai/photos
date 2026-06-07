'use client';

import { AuthProvider } from '@/lib/providers/AuthProvider';
import { UploadProvider } from '@/lib/providers/UploadProvider';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppShell } from '@/components/layout/AppShell';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <AuthProvider>
            <UploadProvider>
                <AuthGuard>
                    <AppShell>{children}</AppShell>
                </AuthGuard>
            </UploadProvider>
        </AuthProvider>
    );
}
