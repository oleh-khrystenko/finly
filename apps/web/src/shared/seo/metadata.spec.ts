jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
    },
}));

import { fetchMetadata } from './metadata';

describe('fetchMetadata', () => {
    it('does NOT include robots block by default (pages indexed)', () => {
        const meta = fetchMetadata({
            page: 'landing',
            href: 'landing',
        });
        expect(meta.robots).toBeUndefined();
    });

    it('emits robots: { index: false, follow: false } when noindex=true', () => {
        const meta = fetchMetadata({
            page: 'privacy',
            href: 'privacy',
            meta: {
                title: 'Privacy',
                description: 'Privacy desc',
            },
            noindex: true,
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('preserves canonical and openGraph regardless of noindex', () => {
        const meta = fetchMetadata({
            page: 'terms',
            href: 'terms',
            meta: { title: 'Terms', description: 'Terms desc' },
            noindex: true,
        });
        expect(meta.title).toBe('Terms');
        expect(meta.alternates?.canonical).toContain('/terms');
        expect(meta.openGraph?.title).toBe('Terms');
    });
});
