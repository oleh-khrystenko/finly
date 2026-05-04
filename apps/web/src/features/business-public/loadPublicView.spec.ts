/**
 * Sprint 3 §3.9 — server-side fetch helper для Server Component
 * `app/host-pay/[slug]/page.tsx`. Тестуємо loadPublicView через mock-fetch.
 */

import { loadPublicView } from './loadPublicView';

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

describe('loadPublicView', () => {
    it('успіх: fetch /api/businesses/public/{slug} + повертає data', async () => {
        const view = {
            type: 'fop',
            name: 'Іваненко',
            slug: 'IvanEnko',
            acceptedBanks: ['privatbank'],
            seoIndexEnabled: false,
            nbuLinks: {
                primary: 'https://qr.bank.gov.ua/...',
                legacy: 'https://bank.gov.ua/qr/...',
            },
        };
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: view }),
        });

        const result = await loadPublicView('IvanEnko');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api:4000/api/businesses/public/IvanEnko',
            { next: { revalidate: 60 } },
        );
        expect(result).toEqual(view);
    });

    it('404 → null (caller робить notFound() у Server Component)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        const result = await loadPublicView('missing');
        expect(result).toBeNull();
    });

    it('500 → throw (Next.js error boundary показує 500-сторінку)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        });

        await expect(loadPublicView('x')).rejects.toThrow(/500/);
    });

    it('encodeURIComponent для slug — спецсимволи не ламають URL', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        await loadPublicView('a b/c');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('a%20b%2Fc'),
            expect.anything(),
        );
    });

    it('crash якщо API_INTERNAL_URL не виставлений — server-side env required', async () => {
        delete process.env.API_INTERNAL_URL;
        await expect(loadPublicView('x')).rejects.toThrow(
            /API_INTERNAL_URL/,
        );
        process.env.API_INTERNAL_URL = 'http://api:4000';
    });

    it('використовує ISR revalidate: 60 (Sprint 3 §F4)', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: {} }),
        });
        await loadPublicView('x');
        const opts = fetchMock.mock.calls[0]![1];
        expect(opts).toEqual({ next: { revalidate: 60 } });
    });
});
