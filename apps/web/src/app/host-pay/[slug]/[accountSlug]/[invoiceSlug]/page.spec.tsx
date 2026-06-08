/**
 * Sprint 4 §4.7 + Sprint 9 §SP-6 — `host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx`
 * Server Component:
 *   - host-check defense-in-depth;
 *   - canonical-case 308 permanentRedirect лише для business-slug;
 *   - 404 при missing invoice;
 *   - `noindex` hardcoded для всіх invoice-сторінок (§4.7);
 *   - SSR every request (`dynamic = 'force-dynamic'`).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicInvoiceView as PublicInvoiceViewData } from '@finly/types';

const mockHeaders = jest.fn();
const mockNotFound = jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
});
const mockPermanentRedirect = jest.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
});
const mockLoadPublicInvoiceView = jest.fn();

jest.mock('next/headers', () => ({
    headers: () => mockHeaders(),
}));

jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    permanentRedirect: (url: string) => mockPermanentRedirect(url),
}));

jest.mock('@/features/invoice-public', () => ({
    InvoicePublicView: ({
        invoiceSlug,
        business,
        account,
    }: {
        invoiceSlug: string;
        business: { slug: string };
        account: { slug: string };
    }) => (
        <div data-testid="invoice-public-view">
            <span data-testid="biz-slug">{business.slug}</span>
            <span data-testid="acc-slug">{account.slug}</span>
            <span data-testid="inv-slug">{invoiceSlug}</span>
        </div>
    ),
    loadPublicInvoiceView: (...args: unknown[]) =>
        mockLoadPublicInvoiceView(...args),
}));

import HostPayInvoicePage, { generateMetadata } from './page';

function makeView(
    overrides: Partial<PublicInvoiceViewData> = {}
): PublicInvoiceViewData {
    return {
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Оплата за консультацію',
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
            primary: 'https://qr.bank.gov.ua/abc',
            legacy: 'https://bank.gov.ua/qr/abc',
        },
        ...overrides,
    };
}

function makeHeaders(host: string | null) {
    return Promise.resolve({
        get: (name: string) => (name.toLowerCase() === 'host' ? host : null),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('HostPayInvoicePage — host defense-in-depth', () => {
    it('host=cabinet → notFound()', async () => {
        mockHeaders.mockReturnValue(makeHeaders('finly.com.ua'));
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'IvanEnko',
                    accountSlug: 'aBc12345',
                    invoiceSlug: 'inv-001-aB3xQ9k7',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('host=PAY.FINLY.COM.UA → render OK', async () => {
        mockHeaders.mockReturnValue(makeHeaders('PAY.FINLY.COM.UA'));
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        const element = await HostPayInvoicePage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('invoice-public-view')).toBeInTheDocument();
    });
});

describe('HostPayInvoicePage — slug lookup', () => {
    beforeEach(() => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
    });

    it('missing invoice → notFound()', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(null);

        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'IvanEnko',
                    accountSlug: 'aBc12345',
                    invoiceSlug: 'no-such',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('canonical business-slug mismatch → permanentRedirect (308) на canonical 3-segment URL', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'ivanenko',
                    accountSlug: 'aBc12345',
                    invoiceSlug: 'inv-001-aB3xQ9k7',
                }),
            })
        ).rejects.toThrow(
            'NEXT_PERMANENT_REDIRECT:/IvanEnko/aBc12345/inv-001-aB3xQ9k7'
        );
    });

    it('Sprint 9 §SP-6 — Server Component прокидає (business, account, invoice) у view', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        const element = await HostPayInvoicePage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('biz-slug')).toHaveTextContent('IvanEnko');
        expect(screen.getByTestId('acc-slug')).toHaveTextContent('aBc12345');
        expect(screen.getByTestId('inv-slug')).toHaveTextContent(
            'inv-001-aB3xQ9k7'
        );
    });
});

describe('generateMetadata', () => {
    beforeEach(() => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
    });

    it('invoice завжди noindex (Sprint 4 §4.7 invariant, незалежно від business.seoIndexEnabled)', async () => {
        // Інваріант hardcoded на page-rівні; навіть якщо business мав
        // seoIndexEnabled=true (root-вивіска індексується), окремі invoice-
        // сторінки — out-of-search.
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('amount=number → title містить "Рахунок на 1 500,00 грн"', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(makeView());

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(meta.title).toMatch(/Рахунок на 1.500,00.+— ФОП Іваненко/);
    });

    it('amount=null → title "Рахунок на оплату — ..."', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(makeView({ amount: null }));

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(meta.title).toMatch(/Рахунок на оплату — ФОП Іваненко/);
    });

    it('missing invoice → "Рахунок не знайдено" + noindex', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(null);

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
                invoiceSlug: 'no-such',
            }),
        });
        expect(meta.title).toBe('Рахунок не знайдено — Finly');
        expect(meta.robots).toEqual({ index: false, follow: false });
    });
});
