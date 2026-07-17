jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_BASE_URL: 'https://finly.com.ua',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

import { loadGuideSlugs } from '@/features/guides';

jest.mock('@/features/guides', () => ({
    loadGuideSlugs: jest.fn().mockResolvedValue(['yak-fop-pryimaty-oplatu']),
}));

import sitemap from './sitemap';

const loadGuideSlugsMock = loadGuideSlugs as jest.MockedFunction<
    typeof loadGuideSlugs
>;

beforeEach(() => {
    loadGuideSlugsMock.mockResolvedValue(['yak-fop-pryimaty-oplatu']);
});

describe('sitemap', () => {
    it('includes landing, help and guides pages', async () => {
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).toContain('https://finly.com.ua');
        expect(urls).toContain('https://finly.com.ua/help');
        expect(urls).toContain('https://finly.com.ua/guides');
        expect(
            urls.some((url) => url.startsWith('https://finly.com.ua/help/'))
        ).toBe(true);
        expect(urls).toContain(
            'https://finly.com.ua/guides/yak-fop-pryimaty-oplatu'
        );
    });

    it('omits the guides section entirely when nothing is published', async () => {
        loadGuideSlugsMock.mockResolvedValue([]);
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).not.toContain('https://finly.com.ua/guides');
        expect(
            urls.some((url) => url.startsWith('https://finly.com.ua/guides/'))
        ).toBe(false);
    });

    it('does not fall over when guide loading fails', async () => {
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        loadGuideSlugsMock.mockRejectedValue(new Error('API down'));
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).toContain('https://finly.com.ua');
        expect(urls).not.toContain('https://finly.com.ua/guides');
        errorSpy.mockRestore();
    });

    it('does not include noindex legal drafts', async () => {
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).not.toContain('https://finly.com.ua/privacy');
        expect(urls).not.toContain('https://finly.com.ua/terms');
    });
});
