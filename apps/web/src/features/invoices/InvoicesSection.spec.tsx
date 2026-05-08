import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// jest.mock потребує бути зверху до imports — інакше real listInvoices
// resolve-нувся б першим. Mock factory повертає jest.fn-stub, ми перенастроюємо
// його resolved-value через `mockListInvoices` у тестах.
const mockListInvoices = jest.fn();
jest.mock('@/shared/api', () => ({
    getApiMessage: jest.fn((code: string) => `[${code}]`),
    listInvoices: (...args: unknown[]) => mockListInvoices(...args),
}));

import InvoicesSection from './InvoicesSection';

const PAY_ORIGIN = 'https://pay.finly.com.ua';

describe('InvoicesSection (Sprint 4 §4.4)', () => {
    beforeEach(() => {
        mockListInvoices.mockReset();
    });

    it('показує spinner до отримання response', () => {
        mockListInvoices.mockReturnValue(new Promise(() => {})); // pending forever
        const { container } = render(
            <InvoicesSection
                businessSlug="IvanEnko"
                businessPaymentPurposeTemplate="Оплата послуг ФОП"
                payPublicOrigin={PAY_ORIGIN}
            />,
        );
        // UiSpinner — окрема Element; перевіряємо presence через querySelector.
        expect(container.querySelector('[role="status"], svg')).toBeTruthy();
    });

    it('empty-state з CTA "Виставити рахунок" коли total=0', async () => {
        mockListInvoices.mockResolvedValue({
            items: [],
            total: 0,
            page: 1,
            limit: 10,
        });
        render(
            <InvoicesSection
                businessSlug="IvanEnko"
                businessPaymentPurposeTemplate="Оплата послуг ФОП"
                payPublicOrigin={PAY_ORIGIN}
            />,
        );

        await waitFor(() => {
            expect(
                screen.getByText(/Поки немає виставлених рахунків/),
            ).toBeInTheDocument();
        });
        // CTA веде на форму створення
        const cta = screen.getByRole('link', {
            name: /Виставити рахунок/,
        });
        expect(cta).toHaveAttribute(
            'href',
            '/business/IvanEnko/invoice/new',
        );
    });

    it('рендерить cards коли є items', async () => {
        mockListInvoices.mockResolvedValue({
            items: [
                {
                    id: '1',
                    businessId: 'b1',
                    slug: 'inv-001-aaaaaaaa',
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: 'Оплата за консультацію',
                    validUntil: null,
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: 1,
                    deletedAt: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
            total: 1,
            page: 1,
            limit: 10,
        });
        render(
            <InvoicesSection
                businessSlug="IvanEnko"
                businessPaymentPurposeTemplate="Оплата послуг ФОП"
                payPublicOrigin={PAY_ORIGIN}
            />,
        );

        await waitFor(() => {
            expect(
                screen.getByText('Оплата за консультацію'),
            ).toBeInTheDocument();
        });
        // Amount-formatted (1500,00 ₴ — uk-UA, з NBSP як thousands)
        expect(screen.getByText(/1\s500,00\s?₴/)).toBeInTheDocument();
        expect(screen.getByText('inv-001-aaaaaaaa')).toBeInTheDocument();
    });

    it('hash-anchor id="invoices" для scroll-into-view з listing-page', async () => {
        mockListInvoices.mockResolvedValue({
            items: [],
            total: 0,
            page: 1,
            limit: 10,
        });
        const { container } = render(
            <InvoicesSection
                businessSlug="IvanEnko"
                businessPaymentPurposeTemplate="Оплата послуг ФОП"
                payPublicOrigin={PAY_ORIGIN}
            />,
        );
        await waitFor(() => {
            expect(container.querySelector('#invoices')).toBeTruthy();
        });
    });

    it('"Завантажити ще" видно лише коли items.length < total', async () => {
        mockListInvoices.mockResolvedValue({
            items: [
                {
                    id: '1',
                    businessId: 'b1',
                    slug: 'a-aaaaaaaa',
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugPreset: null,
                    slugCounterScope: null,
                    slugCounter: null,
                    deletedAt: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
            total: 5,
            page: 1,
            limit: 10,
        });
        render(
            <InvoicesSection
                businessSlug="IvanEnko"
                businessPaymentPurposeTemplate="Оплата послуг ФОП"
                payPublicOrigin={PAY_ORIGIN}
            />,
        );
        await waitFor(() => {
            expect(
                screen.getByRole('button', {
                    name: /Завантажити ще/,
                }),
            ).toBeInTheDocument();
        });
    });
});
