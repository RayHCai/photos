import type { NextConfig } from 'next';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const CDN_BASE_URL = process.env.NEXT_PUBLIC_CDN_BASE_URL;

/**
 * Origins images may be loaded from. The CDN is added when configured; without it
 * everything arrives through the same-origin API proxy.
 */
const imageOrigins = [CDN_BASE_URL, 'https://*.s3.amazonaws.com', 'https://*.amazonaws.com']
    .filter(Boolean)
    .join(' ');

/**
 * Content Security Policy for the documents Next serves.
 *
 * There were no security headers at all on the HTML: helmet only covers the Express
 * API's own responses, which are never rendered as documents. `unsafe-inline` for
 * styles is required by Tailwind's runtime injection and by the inline `style`
 * attributes the justified layout computes per cell.
 */
const csp = [
    "default-src 'self'",
    // Next injects inline bootstrap scripts. 'unsafe-eval' is only needed by React
    // Refresh, so it is omitted in production.
    process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${imageOrigins}`.trim(),
    `media-src 'self' blob: ${imageOrigins}`.trim(),
    // The service worker's thumbnail strategy re-issues cross-origin <img> requests as
    // fetch() calls, which the browser checks against connect-src rather than img-src.
    `connect-src 'self' ${imageOrigins}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
    { key: 'Content-Security-Policy', value: csp },
    // Clickjacking. The session cookie is SameSite=Strict so a framed app would 401
    // anyway, but this is the explicit control rather than an accident of cookie policy.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Share slugs are bearer secrets and must not leak through a Referer header.
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=()',
    },
];

const nextConfig: NextConfig = {
    // Stated explicitly so that disabling either check has to be a deliberate,
    // reviewable change rather than a quiet default.
    typescript: { ignoreBuildErrors: false },
    eslint: { ignoreDuringBuilds: false },

    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
    },

    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${API_INTERNAL_URL}/api/:path*`,
            },
        ];
    },

    images: {
        // The gallery uses plain <img> with a worker-generated width ladder and an
        // explicit srcset, so Next's optimizer would only add a redundant hop.
        unoptimized: true,
    },
};

export default nextConfig;
