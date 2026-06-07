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
 * Hero-h1 = отримувач (`formatPayeeName`): ФОП/ТОВ — частина назви.
 */
describe('PublicBusinessView (Sprint 9 §SP-4)', () => {
    describe('empty-state (accounts.length === 0)', () => {
        it.each<BusinessType>(['individual', 'fop', 'tov', 'organization'])(
            '%s — повідомлення "Власник ще не налаштував реквізити"',
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

        it('hero-h1 = отримувач (з юр-формою) присутній навіть для empty-state', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={[]}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('ФОП Іваненко');
            expect(screen.getByText('Отримувач')).toBeInTheDocument();
        });
    });

    describe('cards-list (accounts.length >= 2)', () => {
        it('hero-h1 = отримувач з юр-формою "ФОП {name}" + підпис «Оберіть реквізити»', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={TWO_ACCOUNTS}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('ФОП Іваненко');
            expect(
                screen.getByText('Оберіть реквізити для оплати')
            ).toBeInTheDocument();
        });

        it('рендерить картку на кожен account: логотип банку + банк-лейбл + маска', () => {
            const { container } = render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={TWO_ACCOUNTS}
                />
            );
            // Логотипи банків — наш патерн UiBankLogo (/banks/<code>.webp).
            expect(
                container.querySelector('img[src="/banks/privatbank.webp"]')
            ).not.toBeNull();
            expect(
                container.querySelector('img[src="/banks/monobank.webp"]')
            ).not.toBeNull();
            // auto-default name (містить маску) → primary = «банк •номер» одним
            // рядком (без «·»).
            expect(screen.getByText('•2580').closest('p')).toHaveTextContent(
                'ПриватБанк •2580'
            );
            expect(screen.getByText('•8104').closest('p')).toHaveTextContent(
                'monobank •8104'
            );
        });

        it('осмислена власна назва → primary назва, банк + маска вторинні', () => {
            render(
                <PublicBusinessView
                    type="fop"
                    name="Іваненко"
                    slug="IvanEnko"
                    accounts={[
                        {
                            slug: 'aBc12345',
                            name: 'Основний',
                            bankCode: 'privatbank',
                            ibanMask: '•2580',
                        },
                    ]}
                />
            );
            expect(screen.getByText('Основний')).toBeInTheDocument();
            const secondary = screen.getByText('•2580').closest('p')!;
            expect(secondary).toHaveTextContent('ПриватБанк');
            expect(secondary).toHaveTextContent('•2580');
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
            // monobank (non-null bankCode) — у combined primary «банк •номер».
            expect(screen.getByText('•8104').closest('p')).toHaveTextContent(
                'monobank •8104'
            );
            // Жодного fallback-тексту для null-bankCode.
            expect(
                screen.queryByText(/Невідомий банк/)
            ).not.toBeInTheDocument();
            // null-bank → primary = сама маска (банк-лейбл drop-ається).
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
