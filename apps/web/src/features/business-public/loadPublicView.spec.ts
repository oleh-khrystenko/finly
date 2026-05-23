/**
 * Sprint 9 §SP-4 — server-side fetch root-вивіски бізнесу для Server
 * Component `app/host-pay/[slug]/page.tsx`. Тестуємо loadPublicView через
 * mock-fetch.
 *
 * Sprint 9 переписаний: shape повертає `accounts: PublicAccountListItem[]`
 * замість `nbuLinks` (Sprint 3 single-account-view зник); fetch-strategy
 * перейшов з ISR `revalidate: 60` на `cache: 'no-store'` (1→2-Account
 * redirect-flip requires fresh state — UAT ACC-2).
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

const sampleView = {
    type: 'fop',
    name: 'Іваненко',
    slug: 'IvanEnko',
    seoIndexEnabled: false,
    accounts: [
        {
            slug: 'aBc12345',
            name: 'ПриватБанк •2580',
            bankCode: 'privatbank',
            ibanMask: '•2580',
        },
    ],
};

describe('loadPublicView (Sprint 9 — accounts list)', () => {
    it('успіх: fetch /api/businesses/public/{slug} + повертає parsed shape з accounts[]', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });

        const result = await loadPublicView('IvanEnko');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api:4000/api/businesses/public/IvanEnko',
            { cache: 'no-store' }
        );
        expect(result).toEqual(sampleView);
        expect(result?.accounts).toHaveLength(1);
    });

    it('успіх: empty accounts[] — 0-Account business валідний shape', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: { ...sampleView, accounts: [] } }),
        });

        const result = await loadPublicView('IvanEnko');
        expect(result?.accounts).toEqual([]);
    });

    it('успіх: 2+ accounts — root-list-view shape', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                data: {
                    ...sampleView,
                    accounts: [
                        sampleView.accounts[0],
                        {
                            slug: 'dEf67890',
                            name: 'monobank •8104',
                            bankCode: 'monobank',
                            ibanMask: '•8104',
                        },
                    ],
                },
            }),
        });

        const result = await loadPublicView('IvanEnko');
        expect(result?.accounts).toHaveLength(2);
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
            expect.anything()
        );
    });

    it('crash якщо API_INTERNAL_URL не виставлений — server-side env required', async () => {
        delete process.env.API_INTERNAL_URL;
        await expect(loadPublicView('x')).rejects.toThrow(/API_INTERNAL_URL/);
        process.env.API_INTERNAL_URL = 'http://api:4000';
    });

    it("використовує `cache: 'no-store'` — Sprint 9 §SP-4 fresh state для 1→2-Account redirect-flip", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });
        await loadPublicView('IvanEnko');
        const opts = fetchMock.mock.calls[0]![1];
        expect(opts).toEqual({ cache: 'no-store' });
    });
});
