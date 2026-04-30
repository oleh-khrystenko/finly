import { resolve } from 'path';
import { config } from 'dotenv';
import type { NextConfig } from 'next';

// Load .env from monorepo root — single source of truth for all env vars.
config({ path: resolve(__dirname, '../../.env') });

// Reverse proxy: all /api requests are forwarded to the backend.
// This keeps API and Web on the same origin, so cookies (bid_refresh)
// are set on the web domain and visible to middleware.
const apiInternalUrl = process.env.API_INTERNAL_URL;

// R2 CDN hostname for user-uploaded avatars. Required — the value must be
// the hostname of the backend's R2_PUBLIC_URL (documented invariant).
const storageHostname = process.env.NEXT_PUBLIC_STORAGE_HOSTNAME;
if (!storageHostname) {
    throw new Error(
        '❌ Environment variable "NEXT_PUBLIC_STORAGE_HOSTNAME" is not defined'
    );
}

const nextConfig: NextConfig = {
    output: 'standalone',
    compress: false,
    reactStrictMode: true,
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
            },
            {
                protocol: 'https',
                hostname: storageHostname,
            },
        ],
    },
    ...(apiInternalUrl && {
        rewrites: async () => [
            {
                source: '/api/:path*',
                destination: `${apiInternalUrl}/api/:path*`,
            },
        ],
    }),
};

export default nextConfig;
