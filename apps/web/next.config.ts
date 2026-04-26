import { resolve } from 'path';
import { config } from 'dotenv';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Load .env from monorepo root — single source of truth for all env vars.
config({ path: resolve(__dirname, '../../.env') });

// Reverse proxy: all /api requests are forwarded to the backend.
// This keeps API and Web on the same origin, so cookies (bid_refresh)
// are set on the web domain and visible to middleware.
const apiInternalUrl = process.env.API_INTERNAL_URL;

// R2 CDN hostname for user-uploaded avatars. Required — the value must be
// the hostname of the backend's R2_PUBLIC_URL (documented invariant). We
// read it via `process.env` directly (not the shared fail-fast helper)
// because `next.config.ts` runs in the Node build context, outside the
// client env module. A missing value is a deployment bug, so we surface
// it as a hard failure at build time rather than silently omitting the
// remote pattern (which would break `next/image` at render time).
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

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
