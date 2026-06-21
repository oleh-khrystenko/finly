jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_BASE_URL: 'https://finly.com.ua',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

import robots from './robots';

describe('robots', () => {
    it('points crawlers at both marketing and pay-host sitemaps', () => {
        expect(robots().sitemap).toEqual([
            'https://finly.com.ua/sitemap.xml',
            'https://pay.finly.com.ua/api/businesses/public/sitemap.xml',
        ]);
    });
});
