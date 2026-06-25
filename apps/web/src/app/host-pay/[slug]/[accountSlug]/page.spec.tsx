/**
 * Sprint 9 §SP-4 — `host-pay/[slug]/[accountSlug]/page.tsx` Server Component:
 *   - host-check defense-in-depth;
 *   - canonical-case 308 permanentRedirect лише для business-slug
 *     (account-slug case-sensitive §SP-10);
 *   - 404 при missing business / account;
 *   - `generateMetadata` SEO robots flag + bank-label у title.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicAccountView as PublicAccountViewData } from '@finly/types';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_BASE_URL: 'https://finly.com.ua',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

jest.mock('@/shared/config/env', () => ({
    ENV: {
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

const mockHeaders = jest.fn();
const mockNotFound = jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
});
const mockPermanentRedirect = jest.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
});
const mockLoadPublicAccountView = jest.fn();

jest.mock('next/headers', () => ({
    headers: () => mockHeaders(),
}));

jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    permanentRedirect: (url: string) => mockPermanentRedirect(url),
}));

jest.mock('@/features/account-public', () => ({
    PublicAccountView: ({
        account,
        business,
    }: {
        account: { slug: string };
        business: { slug: string };
    }) => (
        <div data-testid="public-account-view">
            <span data-testid="business-slug">{business.slug}</span>
            <span data-testid="account-slug">{account.slug}</span>
        </div>
    ),
    loadPublicAccountView: (...args: unknown[]) =>
        mockLoadPublicAccountView(...args),
}));

import HostPayAccountPage, { generateMetadata } from './page';

function makeView(
    overrides: Partial<PublicAccountViewData> = {}
): PublicAccountViewData {
    return {
        slug: 'aBc12345',
        name: 'ПриватБанк •2580',
        bankCode: 'privatbank',
        ibanMask: '•2580',
        business: {
            type: 'fop',
            name: 'Іваненко',
            slug: 'IvanEnko',
            seoIndexEnabled: false,
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

describe('HostPayAccountPage — host defense-in-depth', () => {
    it('host=cabinet → notFound()', async () => {
        mockHeaders.mockReturnValue(makeHeaders('finly.com.ua'));
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        await expect(
            HostPayAccountPage({
                params: Promise.resolve({
                    slug: 'IvanEnko',
                    accountSlug: 'aBc12345',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
        expect(mockNotFound).toHaveBeenCalled();
    });

    it('host=PAY.FINLY.COM.UA (UPPER) → render OK', async () => {
        mockHeaders.mockReturnValue(makeHeaders('PAY.FINLY.COM.UA'));
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const element = await HostPayAccountPage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('public-account-view')).toBeInTheDocument();
    });
});

describe('HostPayAccountPage — slug lookup', () => {
    beforeEach(() => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
    });

    it('missing account → notFound()', async () => {
        mockLoadPublicAccountView.mockResolvedValue(null);

        await expect(
            HostPayAccountPage({
                params: Promise.resolve({
                    slug: 'IvanEnko',
                    accountSlug: 'no-such',
                }),
            })
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('canonical business-slug mismatch → permanentRedirect (308) на canonical', async () => {
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        await expect(
            HostPayAccountPage({
                params: Promise.resolve({
                    slug: 'ivanenko',
                    accountSlug: 'aBc12345',
                }),
            })
        ).rejects.toThrow('NEXT_PERMANENT_REDIRECT:/IvanEnko/aBc12345');
    });

    it('§SP-10 account-slug case-sensitive — НЕ перевіряємо canonical для account-slug', async () => {
        // Backend exact-match-or-404 для account-slug. Якщо backend повернув
        // view — значить account-slug у URL збігається з документом. Сервер
        // не робить redirect-check на account-segment.
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const element = await HostPayAccountPage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('account-slug')).toHaveTextContent(
            'aBc12345'
        );
    });

    it('render full view (business + account)', async () => {
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const element = await HostPayAccountPage({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('business-slug')).toHaveTextContent(
            'IvanEnko'
        );
        expect(screen.getByTestId('account-slug')).toHaveTextContent(
            'aBc12345'
        );
    });
});

describe('generateMetadata', () => {
    beforeEach(() => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
    });

    it('seoIndexEnabled=true → index/follow', async () => {
        mockLoadPublicAccountView.mockResolvedValue(
            makeView({
                business: {
                    type: 'fop',
                    name: 'Іваненко',
                    slug: 'IvanEnko',
                    seoIndexEnabled: true,
                },
            })
        );

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it('seoIndexEnabled=false → noindex', async () => {
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('title містить bank-label + ibanMask на non-null bankCode', async () => {
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.title).toBe(
            'Оплата на ФОП Іваненко (ПриватБанк •2580) — Finly'
        );
    });

    it('adds canonical and social metadata on pay host', async () => {
        mockLoadPublicAccountView.mockResolvedValue(makeView());

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.alternates?.canonical).toBe(
            'https://pay.finly.com.ua/IvanEnko/aBc12345'
        );
        expect(meta.openGraph?.url).toBe(
            'https://pay.finly.com.ua/IvanEnko/aBc12345'
        );
        expect(
            meta.twitter && 'card' in meta.twitter
                ? meta.twitter.card
                : undefined
        ).toBe('summary_large_image');
    });

    it('§SP-9 null-fallback — bankCode=null → bank-label-prefix drop, ibanMask лишається', async () => {
        mockLoadPublicAccountView.mockResolvedValue(
            makeView({ bankCode: null })
        );

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.title).toBe('Оплата на ФОП Іваненко (•2580) — Finly');
    });

    it('cabinet host → noindex (metadata-leak guard)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('finly.com.ua'));

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'aBc12345',
            }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
        expect(mockLoadPublicAccountView).not.toHaveBeenCalled();
    });

    it('missing account → fallback title + noindex', async () => {
        mockLoadPublicAccountView.mockResolvedValue(null);

        const meta = await generateMetadata({
            params: Promise.resolve({
                slug: 'IvanEnko',
                accountSlug: 'no-such',
            }),
        });
        expect(meta.title).toBe('Сторінку не знайдено — Finly');
        expect(meta.robots).toEqual({ index: false, follow: false });
    });
});
