import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
    title: 'Photos',
    description: 'Personal photo and video library',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'Photos',
    },
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    // User zoom is deliberately NOT disabled. maximumScale:1 + userScalable:false
    // failed WCAG 1.4.4 across the whole app, including the login form and the
    // 10-11px timeline labels, and the app's own pinch gestures only cover grid
    // density and the lightbox image. Gesture surfaces opt out locally via
    // touch-action instead.
    maximumScale: 5,
    themeColor: '#292524',
};

/**
 * Register the service worker in production only.
 *
 * Its asset strategy is cache-first, on the grounds that Next.js content-hashes
 * static filenames so a given URL's bytes never change. That holds for a built
 * bundle and is false under `next dev`, which serves chunks at stable unhashed
 * URLs and rewrites them on every edit — so the worker pinned the first version
 * of a chunk it saw and served it forever. The symptom is an edit that never
 * takes effect, or a newly exported function arriving as `undefined` because the
 * browser is running the module from before it was added.
 *
 * The dev branch actively unregisters instead of merely not registering: a
 * worker installed by an earlier visit keeps controlling the page regardless of
 * what this build does, so it has to be torn down explicitly to heal a browser
 * that already has one. Only the app-shell cache is dropped — thumbnails are
 * keyed by random UUID and can never go stale.
 *
 * To exercise the worker locally, run a production build (`next build && next
 * start`) rather than re-enabling it here.
 */
const SERVICE_WORKER_SCRIPT =
    process.env.NODE_ENV === 'production'
        ? `
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js');
                });
            }
          `
        : `
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then((regs) => {
                    regs.forEach((reg) => reg.unregister());
                });
            }
            if (window.caches) {
                caches.keys().then((keys) => {
                    keys.filter((k) => k.startsWith('photos-app-')).forEach((k) => caches.delete(k));
                });
            }
          `;

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cdnBase = process.env.NEXT_PUBLIC_CDN_BASE_URL;
    return (
        <html lang="en">
            <head>
                <link rel="icon" href="/icon.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/icon.svg" />
                {/* Warm the connection to the image CDN so the first thumbnail
                    skips DNS + TCP + TLS. No-op until the CDN base is configured. */}
                {cdnBase && (
                    <>
                        <link rel="preconnect" href={cdnBase} crossOrigin="anonymous" />
                        <link rel="dns-prefetch" href={cdnBase} />
                    </>
                )}
            </head>
            <body className="bg-stone-50 text-stone-900">
                <Providers>{children}</Providers>
                <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_SCRIPT }} />
            </body>
        </html>
    );
}
