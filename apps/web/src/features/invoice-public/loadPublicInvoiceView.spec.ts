/**
 * Sprint 4 §4.7 + Sprint 9 §SP-6 — server-side fetch helper для Server
 * Component `app/host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx`.
 *
 * Sprint 9: URL 3-сегментний (`/account/{accountSlug}/invoices/{invoiceSlug}`)
 * + view shape отримав `account` nested-block (Sprint 9 §SP-6).
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

describe('loadPublicInvoiceView (Sprint 9 — 3-сегментна URL)', () => {
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
        },
        account: {
            slug: 'aBc12345',
            name: 'ПриватБанк •2580',
            bankCode: 'privatbank',
            ibanMask: '•2580',
        },
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/...',
            legacy: 'https://bank.gov.ua/qr/...',
        },
    };

    it('успіх: fetch правильний 3-segment URL + повертає parsed shape з account', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });

        const result = await loadPublicInvoiceView(
            'IvanEnko',
            'aBc12345',
            'inv-001-aB3xQ9k7'
        );
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api:4000/api/businesses/public/IvanEnko/account/aBc12345/invoices/inv-001-aB3xQ9k7',
            { cache: 'no-store' }
        );
        expect(result).toEqual(sampleView);
    });

    it('404 → null', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        const result = await loadPublicInvoiceView('biz', 'acc', 'missing');
        expect(result).toBeNull();
    });

    it('500 → throw', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        });

        await expect(
            loadPublicInvoiceView('biz', 'acc', 'inv')
        ).rejects.toThrow(/500/);
    });

    it('encodeURIComponent для всіх 3 сегментів', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        await loadPublicInvoiceView('a b', 'c/d', 'e f');
        const called = fetchMock.mock.calls[0]![0] as string;
        expect(called).toContain('/a%20b/account/c%2Fd/invoices/e%20f');
    });

    it('crash якщо API_INTERNAL_URL не виставлений', async () => {
        delete process.env.API_INTERNAL_URL;
        await expect(
            loadPublicInvoiceView('biz', 'acc', 'inv')
        ).rejects.toThrow(/API_INTERNAL_URL/);
        process.env.API_INTERNAL_URL = 'http://api:4000';
    });

    it("використовує `cache: 'no-store'` — invoice mutable payment data (review fix)", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ data: sampleView }),
        });
        await loadPublicInvoiceView('biz', 'acc', 'inv');
        const opts = fetchMock.mock.calls[0]![1];
        expect(opts).toEqual({ cache: 'no-store' });
    });
});
