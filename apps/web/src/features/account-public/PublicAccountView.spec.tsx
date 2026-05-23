import React from 'react';
import { render, screen } from '@testing-library/react';
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
    describe('Heading + parenthetical (§SP-9)', () => {
        it('bankCode != null → heading має name + parenthetical "({BANK_LABEL} {ibanMask})"', () => {
            render(<PublicAccountView {...baseProps} />);
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent(
                'Платіж на користь Іваненко через ПриватБанк •2580'
            );
            // Parenthetical disambiguator у sub-line.
            expect(
                screen.getByText('(ПриватБанк •2580)')
            ).toBeInTheDocument();
        });

        it('bankCode === null → parenthetical drop-ає BANK_LABEL, але `•{last4}` лишається unconditional', () => {
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
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent(
                'Платіж на користь Іваненко через Основний'
            );
            // BANK_LABEL-prefix дроп-нутий, ibanMask-postfix unconditional.
            expect(screen.getByText('(•2580)')).toBeInTheDocument();
        });

        it('ФОП перейменував account → heading тримає custom-name + last4-postfix лишається з IBAN-документа', () => {
            render(
                <PublicAccountView
                    {...baseProps}
                    account={{
                        ...baseProps.account,
                        name: 'Основний',
                    }}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent(
                'Платіж на користь Іваненко через Основний'
            );
            expect(
                screen.getByText('(ПриватБанк •2580)')
            ).toBeInTheDocument();
        });
    });

    describe('Bank-grid (Sprint 3 11-bank-inactive pattern)', () => {
        it('рендерить bank-tile для кожного MVP_BANKS елемента (inactive)', () => {
            render(<PublicAccountView {...baseProps} />);
            // BANK_LABEL для privatbank і monobank — обидва присутні у MVP_BANKS.
            expect(screen.getByText('ПриватБанк')).toBeInTheDocument();
            expect(screen.getByText('monobank')).toBeInTheDocument();
        });

        it('aria-disabled на bank-tile (inactive до Sprint 5)', async () => {
            render(<PublicAccountView {...baseProps} />);
            const { MVP_BANKS } = await import('@finly/types');
            const disabledTiles = screen.getAllByTitle('Незабаром');
            expect(disabledTiles).toHaveLength(MVP_BANKS.length);
        });
    });

    describe('CTA NBU links + QR images', () => {
        it('2 active CTAs з nbuLinks (primary + legacy)', () => {
            render(<PublicAccountView {...baseProps} />);
            const primary = screen.getByRole('link', { name: 'Інший банк' });
            const legacy = screen.getByRole('link', {
                name: 'Інший банк (запасний варіант)',
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
            const primaryQr = screen.getByAltText('QR на основну адресу');
            const legacyQr = screen.getByAltText('QR на запасну адресу');
            expect(primaryQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/qr\/nbu\.png\?host=primary$/
            );
            expect(legacyQr.getAttribute('src')).toMatch(
                /\/IvanEnko\/account\/aBc12345\/qr\/nbu\.png\?host=legacy$/
            );
        });
    });
});
