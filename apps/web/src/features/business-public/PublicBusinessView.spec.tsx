import React from 'react';
import { render, screen } from '@testing-library/react';
import type {
    BusinessType,
    PublicAccountListItem,
} from '@finly/types';
import PublicBusinessView from './PublicBusinessView';

const TWO_ACCOUNTS: PublicAccountListItem[] = [
    {
        slug: 'aBc12345',
        name: 'ПриватБанк •2580',
        bankCode: 'privatbank',
        ibanMask: '•2580',
    },
    {
        slug: 'dEf67890',
        name: 'monobank •8104',
        bankCode: 'monobank',
        ibanMask: '•8104',
    },
];

/**
 * Sprint 9 §SP-4 — public root-вивіска бізнесу: empty-state (0 Account) /
 * cards-list (2+ Account). 1-Account випадок резолвиться Server-Component
 * 307-redirect-ом перед render-ом цього компонента; тут не тестується.
 *
 * Sprint 7 §SP-5 heading type-нейтральний — лишається без змін.
 */
describe('PublicBusinessView (Sprint 9 §SP-4)', () => {
    describe('empty-state (accounts.length === 0)', () => {
        it.each<BusinessType>(['individual', 'fop', 'tov', 'organization'])(
            '%s — повідомлення "Власник ще не налаштував жодного рахунку"',
            (type) => {
                render(
                    <PublicBusinessView
                        type={type}
                        name="Іваненко"
                        slug="IvanEnko"
                        accounts={[]}
                    />
                );
                expect(
                    screen.getByText(/Власник ще не налаштував/)
                ).toBeInTheDocument();
            }
        );

        it('heading зі звертанням до бізнесу присутній навіть для empty-state', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={[]}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('Платіж на користь Іваненко');
        });
    });

    describe('cards-list (accounts.length >= 2)', () => {
        it('Sprint 7 §SP-5 type-нейтральний heading "Платіж на користь {name}"', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={TWO_ACCOUNTS}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('Платіж на користь Іваненко');
            // Guard: heading НЕ містить BUSINESS_TYPE_LABEL префіксу.
            expect(heading.textContent).not.toMatch(/^Оплата на/);
        });

        it('рендерить картку на кожен account з name + bank-label + ibanMask', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={TWO_ACCOUNTS}
                />
            );
            expect(screen.getByText('ПриватБанк •2580')).toBeInTheDocument();
            expect(screen.getByText('monobank •8104')).toBeInTheDocument();
            // bank-label-rows (non-null bankCode).
            expect(screen.getByText('ПриватБанк')).toBeInTheDocument();
            expect(screen.getByText('monobank')).toBeInTheDocument();
            // 2 ibanMask-tag-и (•2580 + •8104) — render симетрично.
            expect(screen.getByText('•2580')).toBeInTheDocument();
            expect(screen.getByText('•8104')).toBeInTheDocument();
        });

        it('§SP-9 null-fallback rule — на bankCode=null bank-label-row ВІДСУТНІЙ у DOM (а не fallback на "Невідомий банк")', () => {
            const withNullBank: PublicAccountListItem[] = [
                {
                    slug: 'aBc12345',
                    name: 'Банк •2580',
                    bankCode: null,
                    ibanMask: '•2580',
                },
                {
                    slug: 'dEf67890',
                    name: 'monobank •8104',
                    bankCode: 'monobank',
                    ibanMask: '•8104',
                },
            ];
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={withNullBank}
                />
            );
            // monobank label рендериться (non-null bankCode).
            expect(screen.getByText('monobank')).toBeInTheDocument();
            // Жодного fallback-тексту для null-bankCode.
            expect(
                screen.queryByText(/Невідомий банк/)
            ).not.toBeInTheDocument();
            // ibanMask все одно показуємо — disambiguator.
            expect(screen.getByText('•2580')).toBeInTheDocument();
        });

        it('кожна картка — посилання на /{businessSlug}/{accountSlug} (case-preserved)', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={TWO_ACCOUNTS}
                />
            );
            const links = screen.getAllByRole('link');
            // 2 картки → 2 посилання.
            expect(links).toHaveLength(2);
            expect(links[0]).toHaveAttribute('href', '/IvanEnko/aBc12345');
            expect(links[1]).toHaveAttribute('href', '/IvanEnko/dEf67890');
        });

        it('encodeURIComponent на slug і accountSlug — спецсимволи не ламають URL', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="a b"
                    accounts={[
                        {
                            slug: 'c/d',
                            name: 'Банк',
                            bankCode: null,
                            ibanMask: '•0000',
                        },
                    ]}
                />
            );
            const link = screen.getByRole('link');
            expect(link.getAttribute('href')).toContain('a%20b');
            expect(link.getAttribute('href')).toContain('c%2Fd');
        });
    });
});
