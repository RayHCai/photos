'use client';

import { UploadProvider } from '@/lib/providers/UploadProvider';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppShell } from '@/components/layout/AppShell';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <UploadProvider>
            <AuthGuard>
                <AppShell>{children}</AppShell>
            </AuthGuard>
        </UploadProvider>
    );
}
