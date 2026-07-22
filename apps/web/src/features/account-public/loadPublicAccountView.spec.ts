/**
 * Sprint 9 §SP-4 — server-side fetch helper для Server Component
 * `app/host-pay/[slug]/[accountSlug]/page.tsx`. Той самий patern, що Sprint 3
 * `loadPublicView.spec.ts` і Sprint 4 `loadPublicInvoiceView.spec.ts`.
 */

import { loadPublicAccountView } from './loadPublicAccountView';

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

beforeAll(() => {
    process.env.API_INTERNAL_URL = 'http://api:4000';
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.API_INTERNAL_URL;
});

beforeEach(() => {
    fetchMock.mockReset();
});

describe('loadPublicAccountView', () => {
    const sampleView = {
        slug: 'aBc12345',
        name: 'ПриватБанк •2580',
        bankCode: 'privatbank',
        ibanMask: '•2580',
        business: {
            type: 'fop',
            name: 'Іваненко',
            slug: 'IvanEnko',
            seoIndexEnabled: false,
        },
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/abc',
            legacy: 'https://bank.gov.ua/qr/abc',
        },
        personalizationMarkers: [],
    };

    it('успіх: fetch /api/businesses/public/{biz}/account/{acc} + повертає parsed shape', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });

        const result = await loadPublicAccountView('IvanEnko', 'aBc12345');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api:4000/api/businesses/public/IvanEnko/account/aBc12345',
            { cache: 'no-store' }
        );
        expect(result).toEqual(sampleView);
    });

    it('404 → null (caller робить notFound() у Server Component)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        const result = await loadPublicAccountView('biz', 'missing');
        expect(result).toBeNull();
    });

    it('500 → throw', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        });

        await expect(loadPublicAccountView('biz', 'acc')).rejects.toThrow(
            /500/
        );
    });

    it('encodeURIComponent для обох сегментів', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        await loadPublicAccountView('a b', 'c/d');
        const called = fetchMock.mock.calls[0]![0] as string;
        expect(called).toContain('/a%20b/account/c%2Fd');
    });

    it('crash якщо API_INTERNAL_URL не виставлений', async () => {
        delete process.env.API_INTERNAL_URL;
        await expect(loadPublicAccountView('biz', 'acc')).rejects.toThrow(
            /API_INTERNAL_URL/
        );
        process.env.API_INTERNAL_URL = 'http://api:4000';
    });

    it("використовує `cache: 'no-store'` — fresh state для UI-consistency", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });
        await loadPublicAccountView('biz', 'acc');
        const opts = fetchMock.mock.calls[0]![1];
        expect(opts).toEqual({ cache: 'no-store' });
    });
});
