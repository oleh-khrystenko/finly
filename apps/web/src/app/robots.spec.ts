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

import robots from './robots';

describe('robots', () => {
    it('cabinet host: disallows private zones, points at cabinet sitemap', async () => {
        getHost.mockReturnValue('finly.com.ua');
        const result = await robots();
        expect(result.rules).toEqual({
            userAgent: '*',
            allow: '/',
            disallow: ['/auth/', '/business', '/profile', '/billing'],
        });
        expect(result.sitemap).toBe('https://finly.com.ua/sitemap.xml');
    });

    it('pay host: allows all, points at the public payment sitemap', async () => {
        getHost.mockReturnValue('pay.finly.com.ua');
        const result = await robots();
        expect(result.rules).toEqual({ userAgent: '*', allow: '/' });
        expect(result.sitemap).toBe(
            'https://pay.finly.com.ua/api/businesses/public/sitemap.xml'
        );
    });
});
