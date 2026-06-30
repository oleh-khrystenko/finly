import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BankCode } from '@finly/types';
import PublicAccountView from './PublicAccountView';

const baseProps = {
    account: {
        slug: 'aBc12345',
        name: 'ПриватБанк •2580',
        bankCode: 'privatbank' as BankCode | null,
        ibanMask: '•2580',
    },
    business: {
        type: 'fop' as const,
        name: 'Іваненко',
        slug: 'IvanEnko',
        seoIndexEnabled: false,
    },
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    },
};

describe('PublicAccountView (Sprint 9 §SP-4 + §SP-9)', () => {
    describe('Отримувач (hero) + Реквізити (UiPayeeCard, §SP-9)', () => {
        it('hero-h1 = отримувач з юр-формою; реквізити = банк + маска', () => {
            render(<PublicAccountView {...baseProps} />);
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('ФОП Іваненко');
            // Підписані секції: «Отримувач» (eyebrow) + «Реквізити» (картка).
            expect(screen.getByText('Отримувач')).toBeInTheDocument();
            const requisites = screen.getByText('Реквізити').closest('div')!;
            expect(requisites).toHaveTextContent('ПриватБанк');
            expect(requisites).toHaveTextContent('•2580');
            // Auto-default назва «ПриватБанк •2580» містить маску → не дублюється.
        });

        it('bankCode === null → банк-лейбл drop-ається, маска лишається unconditional', () => {
            render(
                <PublicAccountView
                    {...baseProps}
                    account={{
                        ...baseProps.account,
                        bankCode: null,
                        name: 'Основний',
                    }}
                />
            );
            expect(
                screen.getByRole('heading', { level: 1 })
            ).toHaveTextContent('ФОП Іваненко');
            const requisites = screen.getByText('Реквізити').closest('div')!;
            expect(requisites).toHaveTextContent('•2580');
            expect(requisites).not.toHaveTextContent('ПриватБанк');
            // Кастомна назва (не містить маску) показується вторинним рядком.
            expect(requisites).toHaveTextContent('Основний');
        });

        it('ФОП перейменував account → custom-name + маска лишається з IBAN-документа', () => {
            render(
                <PublicAccountView
                    {...baseProps}
                    account={{
                        ...baseProps.account,
                        name: 'Основний',
                    }}
                />
            );
            const requisites = screen.getByText('Реквізити').closest('div')!;
            expect(requisites).toHaveTextContent('ПриватБанк');
            expect(requisites).toHaveTextContent('•2580');
            expect(requisites).toHaveTextContent('Основний');
        });
    });

    describe('Bank-grid (Sprint 5 — активні per-bank deep-links)', () => {
        it('рендерить активну bank-кнопку для кожного MVP_BANKS елемента', async () => {
            render(<PublicAccountView {...baseProps} />);
            const { MVP_BANKS } = await import('@finly/types');
            const tiles = screen.getAllByRole('button', {
                name: /^Оплатити через /,
            });
            expect(tiles).toHaveLength(MVP_BANKS.length);
            // BANK_LABEL для privatbank і monobank — обидва присутні у сітці
            // (банк-tile + рядок реквізитів → getAllByText, не унікальний).
            expect(screen.getAllByText('ПриватБанк').length).toBeGreaterThan(0);
            expect(screen.getAllByText('monobank').length).toBeGreaterThan(0);
        });

        it('bank-кнопка інтерактивна (type=button, не disabled) — клік не кидає', () => {
            render(<PublicAccountView {...baseProps} />);
            const tile = screen.getByRole('button', {
                name: 'Оплатити через monobank',
            });
            expect(tile).toHaveAttribute('type', 'button');
            expect(tile).not.toBeDisabled();
            // Сам per-bank link-build покритий `packages/types` banks.spec.ts;
            // тут навігацію не асертимо (jsdom `location` non-configurable).
            expect(() => fireEvent.click(tile)).not.toThrow();
        });
    });

    describe('CTA NBU links + QR images (під disclosure)', () => {
        it('app-link CTAs (primary + legacy) доступні через disclosure «Мого банку немає у списку»', () => {
            render(<PublicAccountView {...baseProps} />);
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

        it('QR images мають URL з business + account slug + host=primary|legacy', () => {
            render(<PublicAccountView {...baseProps} />);
            fireEvent.click(
                screen.getByRole('button', {
                    name: /Показати QR для іншого пристрою/,
                })
            );
            const primaryQr = screen.getByAltText('QR для оплати в банку');
            expect(primaryQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/qr\/nbu\.png\?host=primary&v=finly$/
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
                /\/IvanEnko\/account\/aBc12345\/qr\/nbu\.png\?host=legacy&v=finly$/
            );
        });
    });

    describe('Sprint 21 — кастомний логотип бренду', () => {
        it('без бренду: логотип не рендериться, лишається текстовий заголовок', () => {
            render(<PublicAccountView {...baseProps} />);
            expect(
                screen.queryByAltText('ФОП Іваненко')
            ).not.toBeInTheDocument();
            expect(screen.getByText('Отримувач')).toBeInTheDocument();
        });

        it('активний бренд: логотип показується поряд із заголовком', () => {
            render(
                <PublicAccountView
                    {...baseProps}
                    business={{
                        ...baseProps.business,
                        logo: 'https://media.test/brand-logos/x/a.png',
                        brandDisplayName: 'Зерно',
                    }}
                />
            );
            const logo = screen.getByAltText('Зерно');
            expect(logo).toBeInTheDocument();
            expect(logo.getAttribute('src')).toContain('brand-logos');
            // Текстовий заголовок «Отримувач» лишається поряд (не замість).
            expect(screen.getByText('Отримувач')).toBeInTheDocument();
        });
    });
});
