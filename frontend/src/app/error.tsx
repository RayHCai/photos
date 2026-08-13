'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Route-level error boundary.
 *
 * Next.js renders this instead of unmounting the whole tree when a route segment
 * throws. Without it (and without any React error boundary), a single render
 * exception anywhere produced a blank white page.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // No error-reporting service is wired up yet; the console is the only sink.
        console.error('[route error]', error);
    }, [error]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
            <h1 className="text-lg font-medium text-stone-900">Something went wrong</h1>
            <p className="max-w-md text-sm text-stone-500">{error.message}</p>
            <div className="flex gap-2">
                <Button onClick={reset}>Try again</Button>
                <Button variant="secondary" onClick={() => window.location.assign('/')}>
                    Go to library
                </Button>
            </div>
        </div>
    );
}
