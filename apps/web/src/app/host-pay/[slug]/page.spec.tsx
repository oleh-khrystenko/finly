/**
 * Sprint 9 §SP-4 — `host-pay/[slug]/page.tsx` Server Component:
 *   - host-check defense-in-depth (Sprint 3 §3.9);
 *   - canonical-case 308 permanentRedirect (Sprint 3 §E1);
 *   - 0/1/2+ branching на `accounts.length`:
 *     - 0 → render empty-state view;
 *     - 1 → 307 redirect на `/{slug}/{onlyAccount.slug}`;
 *     - 2+ → render list-of-cards view.
 *   - `generateMetadata` robots indexable / noindex (Sprint 3 §E3) + 404 fallback.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicBusinessView as PublicBusinessViewData } from '@finly/types';

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
const mockRedirect = jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
});
const mockLoadPublicView = jest.fn();

jest.mock('next/headers', () => ({
    headers: () => mockHeaders(),
}));

jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    permanentRedirect: (url: string) => mockPermanentRedirect(url),
    redirect: (url: string) => mockRedirect(url),
}));

jest.mock('@/features/business-public', () => ({
    PublicBusinessView: ({
        slug,
        accounts,
    }: {
        slug: string;
        accounts: Array<{ slug: string }>;
    }) => (
        <div data-testid="public-view">
            <span data-testid="slug">{slug}</span>
            <span data-testid="accounts-count">{accounts.length}</span>
        </div>
    ),
    loadPublicView: (...args: unknown[]) => mockLoadPublicView(...args),
}));

import HostPayPage, { generateMetadata } from './page';

function makeView(
    overrides: Partial<PublicBusinessViewData> = {}
): PublicBusinessViewData {
    return {
        type: 'fop',
        name: 'Іваненко',
        slug: 'IvanEnko',
        seoIndexEnabled: false,
        accounts: [],
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

describe('HostPayPage — host defense-in-depth (§3.9)', () => {
    it('host=cabinet (finly.com.ua) → notFound() (middleware-config drift safety net)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(makeView());

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'IvanEnko' }) })
        ).rejects.toThrow('NEXT_NOT_FOUND');

        expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it('host=null (proxy не передав header) → notFound()', async () => {
        mockHeaders.mockReturnValue(makeHeaders(null));
        mockLoadPublicView.mockResolvedValue(makeView());

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'IvanEnko' }) })
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('host=PAY.FINLY.COM.UA (UPPER, RFC 7230 §2.7) → render OK (для empty-state)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('PAY.FINLY.COM.UA'));
        mockLoadPublicView.mockResolvedValue(makeView());

        const element = await HostPayPage({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        render(element as React.ReactElement);
        expect(screen.getByTestId('public-view')).toBeInTheDocument();
    });
});

describe('HostPayPage — slug lookup (§3.1, §E1)', () => {
    it('missing business → notFound()', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(null);

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'no-such' }) })
        ).rejects.toThrow('NEXT_NOT_FOUND');
        expect(mockNotFound).toHaveBeenCalled();
    });

    it('canonical-case mismatch → permanentRedirect на /{canonicalSlug} (§E1, 308)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(makeView());

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'ivanenko' }) })
        ).rejects.toThrow('NEXT_PERMANENT_REDIRECT:/IvanEnko');
        expect(mockPermanentRedirect).toHaveBeenCalledWith('/IvanEnko');
    });
});

describe('HostPayPage — Sprint 9 §SP-4 0/1/2+ branching', () => {
    it('0 Account → render empty-state через PublicBusinessView (accounts.length=0)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(makeView({ accounts: [] }));

        const element = await HostPayPage({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        // 0 — NE redirect; render view з accounts=[].
        expect(mockRedirect).not.toHaveBeenCalled();
        expect(mockPermanentRedirect).not.toHaveBeenCalled();
        render(element as React.ReactElement);
        expect(screen.getByTestId('accounts-count')).toHaveTextContent('0');
    });

    it('1 Account → 307 redirect на /{slug}/{onlyAccount.slug} (НЕ permanentRedirect/308)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(
            makeView({
                accounts: [
                    {
                        slug: 'aBc12345',
                        name: 'ПриватБанк •2580',
                        bankCode: 'privatbank',
                        ibanMask: '•2580',
                    },
                ],
            })
        );

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'IvanEnko' }) })
        ).rejects.toThrow('NEXT_REDIRECT:/IvanEnko/aBc12345');
        // ВАЖЛИВО: 307 (redirect), не 308 (permanentRedirect) — §SP-4
        // rationale (Chrome 308 in-memory cache vs umovniy 1-Account state).
        expect(mockRedirect).toHaveBeenCalledWith('/IvanEnko/aBc12345');
        expect(mockPermanentRedirect).not.toHaveBeenCalled();
    });

    it('2+ Account → render list-of-cards (БЕЗ redirect-у)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(
            makeView({
                accounts: [
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
                ],
            })
        );

        const element = await HostPayPage({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(mockRedirect).not.toHaveBeenCalled();
        expect(mockPermanentRedirect).not.toHaveBeenCalled();
        render(element as React.ReactElement);
        expect(screen.getByTestId('accounts-count')).toHaveTextContent('2');
    });

    it('canonical-mismatch + 1 Account → ПЕРШЕ permanentRedirect на canonical (НЕ 307-на-account)', async () => {
        // Інваріант послідовності: canonical-redirect (Sprint 3 §E1) має
        // спрацювати ПЕРЕД 1-Account redirect-flow, щоб клієнт спочатку
        // отримав canonical-URL.
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(
            makeView({
                accounts: [
                    {
                        slug: 'aBc12345',
                        name: 'ПриватБанк •2580',
                        bankCode: 'privatbank',
                        ibanMask: '•2580',
                    },
                ],
            })
        );

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'ivanenko' }) })
        ).rejects.toThrow('NEXT_PERMANENT_REDIRECT:/IvanEnko');
        expect(mockPermanentRedirect).toHaveBeenCalledWith('/IvanEnko');
        // 307-redirect НЕ викликається — спочатку canonical 308.
        expect(mockRedirect).not.toHaveBeenCalled();
    });
});

describe('generateMetadata — SEO robots (§E3)', () => {
    beforeEach(() => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
    });

    it('seoIndexEnabled=true → robots index/follow', async () => {
        mockLoadPublicView.mockResolvedValue(
            makeView({ seoIndexEnabled: true })
        );

        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it('seoIndexEnabled=false (default) → robots noindex/nofollow', async () => {
        mockLoadPublicView.mockResolvedValue(
            makeView({ seoIndexEnabled: false })
        );

        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('Sprint 7 §SP-5 — title type-aware (на відміну від h1)', async () => {
        mockLoadPublicView.mockResolvedValue(makeView());
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.title).toBe('Оплата на ФОП Іваненко — Finly');
    });

    it('adds canonical and social metadata on pay host', async () => {
        mockLoadPublicView.mockResolvedValue(makeView());
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.alternates?.canonical).toBe(
            'https://pay.finly.com.ua/IvanEnko'
        );
        expect(meta.openGraph?.url).toBe('https://pay.finly.com.ua/IvanEnko');
        expect(meta.twitter?.card).toBe('summary_large_image');
    });

    it('not found → fallback title + noindex (запобігаємо індексацію 404)', async () => {
        mockLoadPublicView.mockResolvedValue(null);
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'missing' }),
        });
        expect(meta.title).toBe('Сторінку не знайдено — Finly');
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('cabinet host → noindex навіть на існуючому slug (host-defense, metadata-leak guard)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('finly.com.ua'));
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
        // loadPublicView НЕ викликається (метадата захищена від cabinet-host
        // fetch-у).
        expect(mockLoadPublicView).not.toHaveBeenCalled();
    });
});
