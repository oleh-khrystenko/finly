jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_BASE_URL: 'https://finly.com.ua',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

const getHost = jest.fn<string | null, []>();
jest.mock('next/headers', () => ({
    headers: async () => ({ get: () => getHost() }),
}));

import { loadGuideSlugsSafe } from '@/features/guides';

// Sitemap споживає build-safe враппер: він сам деградує до [] при недоступному
// API (див. loadGuides.spec), тож тут мокаємо саме його і перевіряємо, як
// sitemap реагує на його результат.
jest.mock('@/features/guides', () => ({
    loadGuideSlugsSafe: jest
        .fn()
        .mockResolvedValue(['yak-fop-pryimaty-oplatu']),
}));

import sitemap from './sitemap';

const loadGuideSlugsMock = loadGuideSlugsSafe as jest.MockedFunction<
    typeof loadGuideSlugsSafe
>;

beforeEach(() => {
    loadGuideSlugsMock.mockResolvedValue(['yak-fop-pryimaty-oplatu']);
    getHost.mockReturnValue('finly.com.ua');
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

    it('still builds the rest of the sitemap when guides degrade to empty', async () => {
        // loadGuideSlugsSafe ковтає помилку API і повертає [] — sitemap мусить
        // спокійно віддати решту сторінок без розділу гайдів.
        loadGuideSlugsMock.mockResolvedValue([]);
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).toContain('https://finly.com.ua');
        expect(urls).not.toContain('https://finly.com.ua/guides');
    });

    it('does not include noindex legal drafts', async () => {
        const urls = (await sitemap()).map((entry) => entry.url);

        expect(urls).not.toContain('https://finly.com.ua/privacy');
        expect(urls).not.toContain('https://finly.com.ua/terms');
    });
});

/**
 * `/sitemap.xml` містить крапку, тож matcher `proxy.ts` його не переписує і
 * pay-хост доходить до цього ж handler-а. Без host-guard-у він віддавав би
 * cabinet-URL-и під публічним платіжним хостом (крос-хостові дублікати).
 * Власна мапа pay-хоста живе в API і адресується з `robots.ts`.
 */
describe('sitemap (host-aware)', () => {
    it('pay host: порожня мапа, жодного cabinet-URL', async () => {
        getHost.mockReturnValue('pay.finly.com.ua');
        await expect(sitemap()).resolves.toEqual([]);
    });
});
