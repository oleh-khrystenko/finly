jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://pay.localhost:3000',
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

    it('falls back to title/description for OG/Twitter when no override', () => {
        const meta = fetchMetadata({
            page: 'landing',
            href: 'landing',
            meta: { title: 'Search Title', description: 'Search desc' },
        });
        expect(meta.openGraph?.title).toBe('Search Title');
        expect(meta.openGraph?.description).toBe('Search desc');
        expect(meta.twitter?.title).toBe('Search Title');
    });

    it('uses ogTitle/ogDescription for OG/Twitter while keeping search title/description', () => {
        const meta = fetchMetadata({
            page: 'landing',
            href: 'landing',
            meta: {
                title: 'Search Title | Finly',
                description: 'Search desc',
                ogTitle: 'Social Hook',
                ogDescription: 'Livelier social desc',
            },
        });
        expect(meta.title).toBe('Search Title | Finly');
        expect(meta.description).toBe('Search desc');
        expect(meta.openGraph?.title).toBe('Social Hook');
        expect(meta.openGraph?.description).toBe('Livelier social desc');
        expect(meta.twitter?.title).toBe('Social Hook');
        expect(meta.twitter?.description).toBe('Livelier social desc');
    });

    it('supports a custom canonical origin for public payment pages', () => {
        const meta = fetchMetadata({
            page: 'public-business',
            href: 'IvanEnko',
            baseUrl: 'https://pay.finly.com.ua/',
            meta: {
                title: 'Оплата на ФОП Іваненко — Finly',
                description: 'Public payment page',
            },
        });

        expect(meta.alternates?.canonical).toBe(
            'https://pay.finly.com.ua/IvanEnko'
        );
    });
});
