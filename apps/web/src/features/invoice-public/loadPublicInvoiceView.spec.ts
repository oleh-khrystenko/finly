/**
 * Sprint 4 §4.7 — server-side fetch helper для Server Component
 * `app/host-pay/[slug]/[invoiceSlug]/page.tsx`. Той самий patern, що Sprint 3
 * `loadPublicView.spec.ts` для бізнесу.
 */

import { loadPublicInvoiceView } from './loadPublicInvoiceView';

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

describe('loadPublicInvoiceView', () => {
    const sampleView = {
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Оплата',
        validUntil: null,
        slug: 'inv-001-aB3xQ9k7',
        business: {
            type: 'fop',
            name: 'Іваненко',
            slug: 'IvanEnko',
            acceptedBanks: ['privatbank'],
        },
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/...',
            legacy: 'https://bank.gov.ua/qr/...',
        },
    };

    it('успіх: fetch правильний 2-segment URL + повертає data', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });

        const result = await loadPublicInvoiceView(
            'IvanEnko',
            'inv-001-aB3xQ9k7',
        );
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api:4000/api/businesses/public/IvanEnko/invoices/inv-001-aB3xQ9k7',
            { next: { revalidate: 60 } },
        );
        expect(result).toEqual(sampleView);
    });

    it('404 → null (caller робить notFound() у Server Component)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        const result = await loadPublicInvoiceView('biz', 'missing');
        expect(result).toBeNull();
    });

    it('500 → throw (Next.js error boundary показує 500-сторінку)', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        });

        await expect(
            loadPublicInvoiceView('biz', 'inv'),
        ).rejects.toThrow(/500/);
    });

    it('encodeURIComponent для обох сегментів — спецсимволи не ламають URL', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        await loadPublicInvoiceView('a b', 'c/d');
        const called = fetchMock.mock.calls[0]![0] as string;
        expect(called).toContain('/a%20b/');
        expect(called).toContain('/invoices/c%2Fd');
    });

    it('crash якщо API_INTERNAL_URL не виставлений — server-side env required', async () => {
        delete process.env.API_INTERNAL_URL;
        await expect(
            loadPublicInvoiceView('biz', 'inv'),
        ).rejects.toThrow(/API_INTERNAL_URL/);
        process.env.API_INTERNAL_URL = 'http://api:4000';
    });

    it('використовує ISR revalidate: 60 (Sprint 3 §F4)', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });
        await loadPublicInvoiceView('biz', 'inv');
        const opts = fetchMock.mock.calls[0]![1];
        expect(opts).toEqual({ next: { revalidate: 60 } });
    });
});
