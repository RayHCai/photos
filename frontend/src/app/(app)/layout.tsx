'use client';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppShell } from '@/components/layout/AppShell';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // UploadProvider now lives at the root (app/providers.tsx) so an in-flight upload
    // survives a redirect out of this route group.
    return (
        <AuthGuard>
            <AppShell>{children}</AppShell>
        </AuthGuard>
    );
}
