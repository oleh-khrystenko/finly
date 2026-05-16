import React from 'react';
import { render, screen } from '@testing-library/react';
import type { BankCode } from '@finly/types';
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
    account: {
        slug: 'aBc12345',
        name: 'ПриватБанк •2580',
        bankCode: 'privatbank' as BankCode | null,
        ibanMask: '•2580',
    },
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    } as { primary: string; legacy: string } | null,
};

describe('InvoicePublicView (Sprint 4 §4.7 + Sprint 9 §SP-6)', () => {
    describe('Heading (Plan: "Рахунок на {amount} ₴" або "Рахунок на оплату")', () => {
        it('amount=number → "Рахунок на 1 500,00 ₴"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
                /Рахунок на.*1\s500,00\s?₴/
            );
        });

        it('amount=null → "Рахунок на оплату" (без суми)', () => {
            render(<InvoicePublicView {...baseProps} amount={null} />);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
                'Рахунок на оплату'
            );
        });
    });

    describe('Sprint 9 §SP-6 — account-sub-info під heading', () => {
        it('bankCode != null → "{BUSINESS_TYPE_LABEL} {business.name} через {account.name} ({BANK_LABEL} {ibanMask})"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.getByText(
                    'ФОП Іваненко через ПриватБанк •2580 (ПриватБанк •2580)'
                )
            ).toBeInTheDocument();
        });

        it('§SP-9 null-fallback — bankCode === null → drop BANK_LABEL-prefix, але `•{last4}` лишається unconditional', () => {
            render(
                <InvoicePublicView
                    {...baseProps}
                    account={{
                        ...baseProps.account,
                        bankCode: null,
                        name: 'Основний',
                    }}
                />
            );
            // Heading-sub-line: "ФОП Іваненко через Основний (•2580)".
            expect(
                screen.getByText('ФОП Іваненко через Основний (•2580)')
            ).toBeInTheDocument();
        });
    });

    describe('Sub-info (Plan: "Призначення: {purpose}" + "Дійсний до: {date|без терміну}")', () => {
        it('завжди рендерить Призначення (resolved-string з backend)', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText('Призначення')).toBeInTheDocument();
            expect(
                screen.getByText('Оплата за консультацію')
            ).toBeInTheDocument();
        });

        it('validUntil=null → "Без терміну"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText('Без терміну')).toBeInTheDocument();
        });

        it('validUntil=Date → форматована дата (uk-UA)', () => {
            const future = new Date('2026-12-31T23:59:59');
            render(<InvoicePublicView {...baseProps} validUntil={future} />);
            expect(
                screen.getByText(future.toLocaleDateString('uk-UA'))
            ).toBeInTheDocument();
        });

        it('amountLocked=true + amount=number → italic-tip про фіксовану суму', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText(/Сума зафіксована/)).toBeInTheDocument();
        });

        it('amountLocked=false + amount=number → italic-tip про можливість редагування', () => {
            render(<InvoicePublicView {...baseProps} amountLocked={false} />);
            expect(
                screen.getByText(/Можна змінити суму у банк-додатку/)
            ).toBeInTheDocument();
        });
    });

    describe('Expired-banner — server-driven через nbuLinks=null (review fix)', () => {
        it('nbuLinks=null → "Термін рахунку минув" banner', () => {
            render(<InvoicePublicView {...baseProps} nbuLinks={null} />);
            expect(
                screen.getByText('Термін рахунку минув')
            ).toBeInTheDocument();
            expect(
                screen.getByText(/Зверніться до отримувача/)
            ).toBeInTheDocument();
        });

        it('nbuLinks=null → CTAs + QR ВІДСУТНІ', () => {
            render(<InvoicePublicView {...baseProps} nbuLinks={null} />);
            expect(
                screen.queryByRole('link', { name: 'Відкрити в банку' })
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('link', { name: 'Запасний варіант' })
            ).not.toBeInTheDocument();
            expect(
                screen.queryByAltText(/QR на основну адресу/)
            ).not.toBeInTheDocument();
        });

        it('nbuLinks=null + validUntil у минулому → дата у sub-info все одно показується', () => {
            const past = new Date('2024-01-01');
            render(
                <InvoicePublicView
                    {...baseProps}
                    nbuLinks={null}
                    validUntil={past}
                />
            );
            expect(
                screen.getByText(past.toLocaleDateString('uk-UA'))
            ).toBeInTheDocument();
        });

        it('active (nbuLinks={primary,legacy}) → 2 CTAs + 2 QRs РЕНДЕРЯТЬСЯ', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.getByRole('link', { name: 'Відкрити в банку' })
            ).toBeInTheDocument();
            expect(
                screen.getByRole('link', { name: 'Запасний варіант' })
            ).toBeInTheDocument();
            expect(
                screen.getByAltText('QR на основну адресу')
            ).toBeInTheDocument();
            expect(
                screen.getByAltText('QR на запасну адресу')
            ).toBeInTheDocument();
        });

        it('validUntil=null + nbuLinks!=null → активний банер не показується', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.queryByText('Термін рахунку минув')
            ).not.toBeInTheDocument();
            expect(
                screen.getByRole('link', { name: 'Відкрити в банку' })
            ).toBeInTheDocument();
        });
    });

    describe('NBU CTA / QR URLs', () => {
        it('CTAs мають правильні NBU URLs з payload', () => {
            render(<InvoicePublicView {...baseProps} />);
            const primary = screen.getByRole('link', {
                name: 'Відкрити в банку',
            });
            const legacy = screen.getByRole('link', {
                name: 'Запасний варіант',
            });
            expect(primary).toHaveAttribute(
                'href',
                'https://qr.bank.gov.ua/abc'
            );
            expect(legacy).toHaveAttribute(
                'href',
                'https://bank.gov.ua/qr/abc'
            );
        });

        it('Sprint 9 §SP-6 — QR URL 3-сегментний: business + account + invoice slug + host param', () => {
            render(<InvoicePublicView {...baseProps} />);
            const primaryQr = screen.getByAltText('QR на основну адресу');
            const legacyQr = screen.getByAltText('QR на запасну адресу');
            expect(primaryQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=primary$/
            );
            expect(legacyQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=legacy$/
            );
        });
    });
});
