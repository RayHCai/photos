import type { NextConfig } from 'next';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${API_INTERNAL_URL}/api/:path*`,
            },
        ];
    },
    images: {
        unoptimized: true,
    },
};

export default nextConfig;
