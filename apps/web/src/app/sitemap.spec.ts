jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_BASE_URL: 'https://finly.com.ua',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

import sitemap from './sitemap';

describe('sitemap', () => {
    it('includes landing and help pages', () => {
        const urls = sitemap().map((entry) => entry.url);

        expect(urls).toContain('https://finly.com.ua');
        expect(urls).toContain('https://finly.com.ua/help');
        expect(
            urls.some((url) => url.startsWith('https://finly.com.ua/help/'))
        ).toBe(true);
    });

    it('does not include noindex legal drafts', () => {
        const urls = sitemap().map((entry) => entry.url);

        expect(urls).not.toContain('https://finly.com.ua/privacy');
        expect(urls).not.toContain('https://finly.com.ua/terms');
    });
});
