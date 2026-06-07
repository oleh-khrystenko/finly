import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BankCode } from '@finly/types';
import InvoicePublicView from './InvoicePublicView';

const baseProps = {
    amount: 150000,
    paymentPurpose: 'Оплата за консультацію',
    validUntil: null as Date | null,
    invoiceSlug: 'inv-001-aB3xQ9k7',
    business: {
        type: 'fop' as const,
        name: 'Іваненко',
        slug: 'IvanEnko',
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
    describe('Heading (Plan: "Рахунок на {amount} грн" або "Рахунок на оплату")', () => {
        it('amount=number → "Рахунок на 1 500,00 грн"', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
                /Рахунок на.*1\s500,00\sгрн/
            );
        });

        it('amount=null → "Рахунок на оплату" (без суми)', () => {
            render(<InvoicePublicView {...baseProps} amount={null} />);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
                'Рахунок на оплату'
            );
        });
    });

    describe('UiPayeeCard — Отримувач + Реквізити (§SP-6 / §SP-9)', () => {
        it('bankCode != null → Отримувач="ФОП {name}", Реквізити=банк + маска', () => {
            render(<InvoicePublicView {...baseProps} />);
            const recipient = screen.getByText('Отримувач').closest('div')!;
            expect(recipient).toHaveTextContent('ФОП Іваненко');
            const requisites = screen.getByText('Реквізити').closest('div')!;
            expect(requisites).toHaveTextContent('ПриватБанк');
            expect(requisites).toHaveTextContent('•2580');
        });

        it('§SP-9 null-fallback — bankCode === null → банк drop-ається, маска лишається', () => {
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
            const requisites = screen.getByText('Реквізити').closest('div')!;
            expect(requisites).not.toHaveTextContent('ПриватБанк');
            expect(requisites).toHaveTextContent('•2580');
            expect(requisites).toHaveTextContent('Основний');
        });
    });

    describe('Sub-info (Призначення + майбутній «Дійсний до»)', () => {
        it('завжди рендерить Призначення (resolved-string з backend)', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.getByText('Призначення')).toBeInTheDocument();
            expect(
                screen.getByText('Оплата за консультацію')
            ).toBeInTheDocument();
        });

        it('validUntil=null → рядок «Дійсний до» відсутній (без обмеження)', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(screen.queryByText('Дійсний до')).not.toBeInTheDocument();
            expect(screen.queryByText('Без терміну')).not.toBeInTheDocument();
        });

        it('validUntil=Date (активний) → форматована дата (uk-UA) у sub-info', () => {
            const future = new Date('2026-12-31T23:59:59');
            render(<InvoicePublicView {...baseProps} validUntil={future} />);
            expect(screen.getByText('Дійсний до')).toBeInTheDocument();
            expect(
                screen.getByText(future.toLocaleDateString('uk-UA'))
            ).toBeInTheDocument();
        });
    });

    describe('Expired-banner — server-driven через nbuLinks=null (review fix)', () => {
        it('nbuLinks=null → "Термін оплати минув" banner з поясненням + дією', () => {
            render(<InvoicePublicView {...baseProps} nbuLinks={null} />);
            expect(
                screen.getByText('Термін оплати минув')
            ).toBeInTheDocument();
            expect(
                screen.getByText(/недоступний для оплати/)
            ).toBeInTheDocument();
            expect(
                screen.getByText(/Зверніться до отримувача/)
            ).toBeInTheDocument();
        });

        it('nbuLinks=null → платіжна секція ВІДСУТНЯ (ні сітки банків, ні disclosure)', () => {
            render(<InvoicePublicView {...baseProps} nbuLinks={null} />);
            expect(
                screen.queryByText('Оберіть банк для оплати')
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', {
                    name: /Мого банку немає у списку/,
                })
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', {
                    name: /Показати QR для іншого пристрою/,
                })
            ).not.toBeInTheDocument();
        });

        it('nbuLinks=null + validUntil у минулому → дата у банері, нейтрального sub-info рядка немає', () => {
            const past = new Date('2024-01-01');
            render(
                <InvoicePublicView
                    {...baseProps}
                    nbuLinks={null}
                    validUntil={past}
                />
            );
            const dateLabel = past.toLocaleDateString('uk-UA');
            // Дата — у банері минулого терміну (з причиною), не в sub-info.
            expect(
                screen.getByText(
                    new RegExp(`Цей рахунок був дійсний до ${dateLabel}`)
                )
            ).toBeInTheDocument();
            expect(screen.queryByText('Дійсний до')).not.toBeInTheDocument();
        });

        it('active (nbuLinks={primary,legacy}) → сітка банків видима; CTA + QR доступні через disclosure', () => {
            render(<InvoicePublicView {...baseProps} />);
            // Сітка банків — головна дія, видима одразу.
            expect(
                screen.getByText('Оберіть банк для оплати')
            ).toBeInTheDocument();

            // App-link сховані під disclosure — розкриваємо.
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Мого банку немає у списку/,
                })
            );
            expect(
                screen.getByRole('link', { name: 'Відкрити банк-додаток' })
            ).toBeInTheDocument();

            // QR під окремим disclosure (+ вкладений запасний код).
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Показати QR для іншого пристрою/,
                })
            );
            expect(
                screen.getByAltText('QR для оплати в банку')
            ).toBeInTheDocument();
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Запасний код, якщо не зчитався/,
                })
            );
            expect(
                screen.getByAltText('Запасний QR для оплати в банку')
            ).toBeInTheDocument();
        });

        it('validUntil=null + nbuLinks!=null → активний банер не показується', () => {
            render(<InvoicePublicView {...baseProps} />);
            expect(
                screen.queryByText('Термін рахунку минув')
            ).not.toBeInTheDocument();
            expect(
                screen.getByText('Оберіть банк для оплати')
            ).toBeInTheDocument();
        });
    });

    describe('NBU CTA / QR URLs', () => {
        it('CTAs мають правильні NBU URLs з payload', () => {
            render(<InvoicePublicView {...baseProps} />);
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Мого банку немає у списку/,
                })
            );
            const primary = screen.getByRole('link', {
                name: 'Відкрити банк-додаток',
            });
            const legacy = screen.getByRole('link', {
                name: 'Інший спосіб, якщо не відкрилось',
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
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Показати QR для іншого пристрою/,
                })
            );
            const primaryQr = screen.getByAltText('QR для оплати в банку');
            expect(primaryQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=primary$/
            );
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Запасний код, якщо не зчитався/,
                })
            );
            const legacyQr = screen.getByAltText(
                'Запасний QR для оплати в банку'
            );
            expect(legacyQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/invoices\/inv-001-aB3xQ9k7\/qr\/nbu\.png\?host=legacy$/
            );
        });
    });
});
