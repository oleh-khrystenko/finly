import { buildSitemapXml } from './public-businesses.controller';

describe('buildSitemapXml', () => {
    it('escapes XML-sensitive URL characters and writes ISO lastmod', () => {
        const xml = buildSitemapXml([
            {
                loc: 'https://pay.finly.com.ua/FOP?a=1&b=2',
                lastmod: new Date('2026-06-21T10:20:30.000Z'),
            },
        ]);

        expect(xml).toContain(
            '<loc>https://pay.finly.com.ua/FOP?a=1&amp;b=2</loc>'
        );
        expect(xml).toContain('<lastmod>2026-06-21T10:20:30.000Z</lastmod>');
        expect(xml).toContain(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        );
    });

    it('omits lastmod when not provided', () => {
        const xml = buildSitemapXml([
            { loc: 'https://pay.finly.com.ua/IvanEnko' },
        ]);

        expect(xml).toContain('<loc>https://pay.finly.com.ua/IvanEnko</loc>');
        expect(xml).not.toContain('<lastmod>');
    });
});
