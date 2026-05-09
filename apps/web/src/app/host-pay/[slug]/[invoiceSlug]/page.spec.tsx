/**
 * Sprint 4 §4.7 DoD — host-pay/[slug]/[invoiceSlug]/page.tsx Server Component:
 *   - render для valid invoice;
 *   - canonical-case permanentRedirect для business-slug (case-mismatch);
 *   - invoice-slug case-sensitive — НЕ redirect (SP-8: backend сам поверне 404);
 *   - notFound() для missing invoice;
 *   - host-check defense-in-depth (notFound при cabinet host);
 *   - generateMetadata з noindex для всіх invoices (Sprint 4 §4.7).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicInvoiceView } from '@finly/types';

const mockHeaders = jest.fn();
const mockNotFound = jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
});
const mockPermanentRedirect = jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
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
        nbuLinks,
    }: {
        invoiceSlug: string;
        business: { slug: string };
        nbuLinks: { primary: string; legacy: string };
    }) => (
        <div data-testid="invoice-public-view">
            <span data-testid="invoice-slug">{invoiceSlug}</span>
            <span data-testid="business-slug">{business.slug}</span>
            <a data-testid="cta-primary" href={nbuLinks.primary}>
                primary
            </a>
        </div>
    ),
    loadPublicInvoiceView: (...args: unknown[]) =>
        mockLoadPublicInvoiceView(...args),
}));

import HostPayInvoicePage, { generateMetadata } from './page';

const baseView: PublicInvoiceView = {
    amount: 150000,
    amountLocked: true,
    paymentPurpose: 'Оплата за консультацію',
    validUntil: null,
    slug: 'inv-001-aB3xQ9k7',
    business: {
        type: 'fop',
        name: 'Іваненко',
        slug: 'IvanEnko',
        acceptedBanks: ['privatbank', 'monobank'],
    },
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    },
};

beforeEach(() => {
    mockHeaders.mockReset();
    mockNotFound.mockClear();
    mockPermanentRedirect.mockClear();
    mockLoadPublicInvoiceView.mockReset();
    mockHeaders.mockReturnValue({
        get: (k: string) => (k === 'host' ? 'pay.finly.com.ua' : null),
    });
    mockLoadPublicInvoiceView.mockResolvedValue(baseView);
});

describe('host-pay/[slug]/[invoiceSlug]/page (Sprint 4 §4.7)', () => {
    it('успіх: render InvoicePublicView для valid request', async () => {
        const ui = await HostPayInvoicePage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        render(ui);
        expect(screen.getByTestId('invoice-public-view')).toBeInTheDocument();
        expect(screen.getByTestId('invoice-slug')).toHaveTextContent(
            'inv-001-aB3xQ9k7'
        );
        expect(screen.getByTestId('business-slug')).toHaveTextContent(
            'IvanEnko'
        );
    });

    it('canonical-redirect business-slug: case-mismatch → 308 на canonical (DoD §4.7)', async () => {
        // Backend lookup case-insensitive повернув canonical "IvanEnko";
        // user ввів "ivanenko" — Server Component має redirect-нути.
        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'ivanenko',
                    invoiceSlug: 'inv-001-aB3xQ9k7',
                }),
            })
        ).rejects.toThrow(/NEXT_REDIRECT:\/IvanEnko\/inv-001-aB3xQ9k7/);
        expect(mockPermanentRedirect).toHaveBeenCalledWith(
            '/IvanEnko/inv-001-aB3xQ9k7'
        );
    });

    it('invoice-slug case-sensitive: same business + diff invoice case → НЕ redirect (SP-8)', async () => {
        // Sprint 4 review fix — раніше тут передавався той самий canonical
        // slug `inv-001-aB3xQ9k7`, тож тест пропускав: assertion справджувалась
        // бо case match-ив, а не бо canonical-redirect-логіка ігнорує invoice-
        // slug-case-mismatch. Зараз справді передаємо case-mismatched slug.
        //
        // SP-8 invariant: business-slug case-insensitive (canonical-redirect),
        // invoice-slug case-sensitive (exact-match-or-404 на backend; navigator
        // case-mismatch ніколи не доходить до Server Component, бо API повертає
        // 404 і `loadPublicInvoiceView` віддає `null`). Цей тест замикає
        // defensive code-path на випадок, якщо backend змінить case-семантику
        // у Phase 1.5+ — Server Component все одно НЕ робить redirect для
        // invoice-slug-mismatch.
        const ui = await HostPayInvoicePage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                invoiceSlug: 'INV-001-AB3XQ9K7', // case-mismatch vs canonical
            }),
        });
        render(ui);
        expect(mockPermanentRedirect).not.toHaveBeenCalled();
        expect(screen.getByTestId('invoice-public-view')).toBeInTheDocument();
        // Page render-ить view.slug (canonical), не user-input — single source
        // of truth для slug у render-i — backend response.
        expect(screen.getByTestId('invoice-slug')).toHaveTextContent(
            'inv-001-aB3xQ9k7'
        );
    });

    it('missing invoice: backend → null → notFound()', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(null);
        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'biz',
                    invoiceSlug: 'missing',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('cabinet host: defense-in-depth → notFound()', async () => {
        mockHeaders.mockReturnValue({
            get: (k: string) => (k === 'host' ? 'finly.com.ua' : null),
        });
        await expect(
            HostPayInvoicePage({
                params: Promise.resolve({
                    slug: 'IvanEnko',
                    invoiceSlug: 'inv-001-aB3xQ9k7',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
        // loadPublicInvoiceView НЕ викликався — host-check блокує до fetch-у.
        expect(mockLoadPublicInvoiceView).not.toHaveBeenCalled();
    });
});

describe('generateMetadata (Sprint 4 §4.7 — invoices завжди noindex)', () => {
    beforeEach(() => {
        mockLoadPublicInvoiceView.mockReset();
        mockLoadPublicInvoiceView.mockResolvedValue(baseView);
    });

    it('noindex для всіх invoice-сторінок (на відміну від бізнесу)', async () => {
        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('title з amount: "Рахунок на {amount} — {Тип Назва}"', async () => {
        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(String(meta.title)).toMatch(/Рахунок на.*1\s500,00\s?₴/);
        expect(String(meta.title)).toContain('ФОП Іваненко');
    });

    it('title без amount (signage): "Рахунок на оплату — {Тип Назва}"', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue({
            ...baseView,
            amount: null,
            amountLocked: false,
        });
        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                invoiceSlug: 'inv-001-aB3xQ9k7',
            }),
        });
        expect(String(meta.title)).toContain('Рахунок на оплату');
        expect(String(meta.title)).not.toMatch(/₴/);
    });

    it('missing invoice: title "Рахунок не знайдено" + noindex', async () => {
        mockLoadPublicInvoiceView.mockResolvedValue(null);
        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'biz',
                invoiceSlug: 'missing',
            }),
        });
        expect(meta.title).toBe('Рахунок не знайдено — Finly');
        expect(meta.robots).toEqual({ index: false, follow: false });
    });
});
