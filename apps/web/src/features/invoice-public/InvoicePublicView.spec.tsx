import React from 'react';
import { render, screen } from '@testing-library/react';
import InvoicePublicView from './InvoicePublicView';

const baseProps = {
    amount: 150000,
    amountLocked: true,
    paymentPurpose: 'Оплата за консультацію',
    validUntil: null as Date | null,
    invoiceSlug: 'inv-001-aB3xQ9k7',
    business: {
        type: 'fop' as const,
        name: 'Іваненко',
        slug: 'IvanEnko',
        acceptedBanks: ['privatbank' as const, 'monobank' as const],
    },
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    },
};

describe('InvoicePublicView (Sprint 4 §4.7)', () => {
    describe('Heading (Plan: "Рахунок на {amount} ₴" або "Рахунок на оплату")', () => {
        it('amount=number → "Рахунок на 1 500,00 ₴"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.getByRole('heading', { level: 1 }),
            ).toHaveTextContent(/Рахунок на.*1\s500,00\s?₴/);
        });

        it('amount=null → "Рахунок на оплату" (без суми)', () => {
            render(<InvoicePublicView {...baseProps} amount={null} />);
            expect(
                screen.getByRole('heading', { level: 1 }),
            ).toHaveTextContent('Рахунок на оплату');
        });
    });

    describe('Sub-info (Plan: "Призначення: {purpose}" + "Дійсний до: {date|без терміну}")', () => {
        it('завжди рендерить Призначення (resolved-string з backend)', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText('Призначення')).toBeInTheDocument();
            expect(
                screen.getByText('Оплата за консультацію'),
            ).toBeInTheDocument();
        });

        it('validUntil=null → "Без терміну"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText('Без терміну')).toBeInTheDocument();
        });

        it('validUntil=Date → форматована дата (uk-UA)', () => {
            const future = new Date('2026-12-31T23:59:59');
            render(
                <InvoicePublicView {...baseProps} validUntil={future} />,
            );
            expect(
                screen.getByText(future.toLocaleDateString('uk-UA')),
            ).toBeInTheDocument();
        });

        it('amountLocked=true + amount=number → italic-tip про фіксовану суму', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.getByText(/Сума зафіксована/),
            ).toBeInTheDocument();
        });

        it('amountLocked=false + amount=number → italic-tip про можливість редагування', () => {
            render(
                <InvoicePublicView {...baseProps} amountLocked={false} />,
            );
            expect(
                screen.getByText(/Можна змінити суму у банк-додатку/),
            ).toBeInTheDocument();
        });
    });

    describe('Expired-banner sanity-block (Plan: validUntil < now → заміщення payment-flow)', () => {
        it('validUntil у минулому → "Термін рахунку минув"', () => {
            const past = new Date('2024-01-01');
            render(
                <InvoicePublicView {...baseProps} validUntil={past} />,
            );
            expect(
                screen.getByText('Термін рахунку минув'),
            ).toBeInTheDocument();
            expect(
                screen.getByText(/Зверніться до отримувача/),
            ).toBeInTheDocument();
        });

        it('expired → банк-grid + CTAs + QR ВІДСУТНІ', () => {
            const past = new Date('2024-01-01');
            render(
                <InvoicePublicView {...baseProps} validUntil={past} />,
            );
            // Жодного "Інший банк"-CTA
            expect(
                screen.queryByText('Інший банк'),
            ).not.toBeInTheDocument();
            // Жодного QR-img
            expect(
                screen.queryByAltText(/QR на основну адресу/),
            ).not.toBeInTheDocument();
        });

        it('active → банк-grid + 2 CTAs + 2 QRs РЕНДЕРЯТЬСЯ', () => {
            const future = new Date();
            future.setFullYear(future.getFullYear() + 1);
            render(
                <InvoicePublicView {...baseProps} validUntil={future} />,
            );
            // 2 CTAs:
            expect(
                screen.getAllByRole('link', { name: /Інший банк/ }).length,
            ).toBe(2);
            // 2 QR images:
            expect(
                screen.getByAltText('QR на основну адресу'),
            ).toBeInTheDocument();
            expect(
                screen.getByAltText('QR на запасну адресу'),
            ).toBeInTheDocument();
        });

        it('validUntil=null → активний банер не показується (active-state)', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.queryByText('Термін рахунку минув'),
            ).not.toBeInTheDocument();
            expect(
                screen.getAllByRole('link', { name: /Інший банк/ }).length,
            ).toBe(2);
        });
    });

    describe('NBU CTA / QR URLs', () => {
        it('CTAs мають правильні NBU URLs з payload', () => {
            render(<InvoicePublicView {...baseProps} />);
            const links = screen.getAllByRole('link', {
                name: /Інший банк/,
            });
            expect(links[0]).toHaveAttribute(
                'href',
                'https://qr.bank.gov.ua/abc',
            );
            expect(links[1]).toHaveAttribute(
                'href',
                'https://bank.gov.ua/qr/abc',
            );
        });

        it('QR images мають URL з business + invoice slug + host=primary|legacy', () => {
            render(<InvoicePublicView {...baseProps} />);
            const primaryQr = screen.getByAltText('QR на основну адресу');
            const legacyQr = screen.getByAltText('QR на запасну адресу');
            expect(primaryQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=primary$/,
            );
            expect(legacyQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=legacy$/,
            );
        });
    });
});
