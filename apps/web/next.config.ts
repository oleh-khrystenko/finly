import { resolve } from 'path';
import { config } from 'dotenv';
import type { NextConfig } from 'next';

// Load .env from monorepo root — single source of truth for all env vars.
config({ path: resolve(__dirname, '../../.env') });

// Reverse proxy: all /api requests are forwarded to the backend.
// This keeps API and Web on the same origin, so cookies (bid_refresh)
// are set on the web domain and visible to middleware.
const apiInternalUrl = process.env.API_INTERNAL_URL;

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`❌ Environment variable "${name}" is not defined`);
    }
    return value;
}

function hostnameOf(name: string): string {
    const raw = requireEnv(name);
    try {
        return new URL(raw).hostname;
    } catch {
        throw new Error(`❌ ${name} must be an absolute URL (got "${raw}")`);
    }
}

/**
 * Next inline-ить у клієнтський бандл лише змінні з префіксом `NEXT_PUBLIC_`,
 * тож origin-и кабінету і pay-зони проростають сюди під другим іменем. Але
 * ЗНАЧЕННЯ лишається одне: джерело — `WEB_URL` / `PAY_PUBLIC_URL`, ті самі
 * змінні, що читає API. Дві незалежні копії одного origin-а розсинхронізуються
 * мовчки: кабінет вважав би публічною зоною не той хост, і `proxy.ts` віддавав
 * би 404 замість сторінок.
 */
function exposeAsPublic(publicName: string, sourceName: string): void {
    process.env[publicName] = requireEnv(sourceName);
}

exposeAsPublic('NEXT_PUBLIC_BASE_URL', 'WEB_URL');
exposeAsPublic('NEXT_PUBLIC_PAY_PUBLIC_URL', 'PAY_PUBLIC_URL');

// Хост R2 для `next/image`: беремо з того самого `R2_PUBLIC_URL`, що й API,
// щоб хост картинок і хост сховища не могли розійтися.
const storageHostname = hostnameOf('R2_PUBLIC_URL');

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
