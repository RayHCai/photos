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
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            if ('serviceWorker' in navigator) {
                                window.addEventListener('load', () => {
                                    navigator.serviceWorker.register('/sw.js');
                                });
                            }
                        `,
                    }}
                />
            </body>
        </html>
    );
}
