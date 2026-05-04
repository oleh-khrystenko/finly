/**
 * Sprint 3 §3.9 DoD smoke-test для public Server Component:
 *   - render для seoIndexEnabled=true|false (generateMetadata robots);
 *   - canonical-case permanentRedirect;
 *   - notFound() для missing business;
 *   - host-check defense-in-depth (notFound при cabinet host).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import type { PublicBusinessView as PublicBusinessViewData } from '@finly/types';

const mockHeaders = jest.fn();
const mockNotFound = jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
});
const mockPermanentRedirect = jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
});
const mockLoadPublicView = jest.fn();

jest.mock('next/headers', () => ({
    headers: () => mockHeaders(),
}));

jest.mock('next/navigation', () => ({
    notFound: () => mockNotFound(),
    permanentRedirect: (url: string) => mockPermanentRedirect(url),
}));

jest.mock('@/features/business-public', () => ({
    PublicBusinessView: ({
        slug,
        nbuLinks,
    }: {
        slug: string;
        nbuLinks: { primary: string; legacy: string };
    }) => (
        <div data-testid="public-view">
            <span data-testid="slug">{slug}</span>
            <a data-testid="cta-primary" href={nbuLinks.primary}>
                primary
            </a>
            <a data-testid="cta-legacy" href={nbuLinks.legacy}>
                legacy
            </a>
        </div>
    ),
    loadPublicView: (...args: unknown[]) => mockLoadPublicView(...args),
}));

import HostPayPage, { generateMetadata } from './page';

const baseView: PublicBusinessViewData = {
    type: 'fop',
    name: 'Іваненко',
    slug: 'IvanEnko',
    acceptedBanks: ['privatbank', 'monobank'],
    seoIndexEnabled: false,
    nbuLinks: {
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    },
};

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
        mockLoadPublicView.mockResolvedValue(baseView);

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'IvanEnko' }) }),
        ).rejects.toThrow('NEXT_NOT_FOUND');

        expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it('host=null (proxy не передав header) → notFound()', async () => {
        mockHeaders.mockReturnValue(makeHeaders(null));
        mockLoadPublicView.mockResolvedValue(baseView);

        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'IvanEnko' }) }),
        ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('host=PAY.FINLY.COM.UA (UPPER, RFC 7230 §2.7) → render OK', async () => {
        mockHeaders.mockReturnValue(makeHeaders('PAY.FINLY.COM.UA'));
        mockLoadPublicView.mockResolvedValue(baseView);

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
            HostPayPage({ params: Promise.resolve({ slug: 'no-such' }) }),
        ).rejects.toThrow('NEXT_NOT_FOUND');
        expect(mockNotFound).toHaveBeenCalled();
    });

    it('canonical-case mismatch → permanentRedirect на /{canonicalSlug} (§E1)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        // Backend lookup case-insensitive повертає бізнес з canonical-case slug.
        mockLoadPublicView.mockResolvedValue({
            ...baseView,
            slug: 'IvanEnko', // canonical
        });

        // URL-input lowercased — має redirect-итись.
        await expect(
            HostPayPage({ params: Promise.resolve({ slug: 'ivanenko' }) }),
        ).rejects.toThrow('NEXT_REDIRECT:/IvanEnko');
        expect(mockPermanentRedirect).toHaveBeenCalledWith('/IvanEnko');
    });

    it('slug exact-match canonical → render без redirect-у', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(baseView);

        const element = await HostPayPage({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(mockPermanentRedirect).not.toHaveBeenCalled();

        render(element as React.ReactElement);
        expect(screen.getByTestId('slug')).toHaveTextContent('IvanEnko');
    });
});

describe('HostPayPage — render (§3.9 §E7)', () => {
    it('передає nbuLinks у PublicBusinessView (CTA працюють як real app-links)', async () => {
        mockHeaders.mockReturnValue(makeHeaders('pay.finly.com.ua'));
        mockLoadPublicView.mockResolvedValue(baseView);

        const element = await HostPayPage({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        render(element as React.ReactElement);

        expect(screen.getByTestId('cta-primary')).toHaveAttribute(
            'href',
            'https://qr.bank.gov.ua/abc',
        );
        expect(screen.getByTestId('cta-legacy')).toHaveAttribute(
            'href',
            'https://bank.gov.ua/qr/abc',
        );
    });
});

describe('generateMetadata — SEO robots (§E3)', () => {
    it('seoIndexEnabled=true → robots index/follow', async () => {
        mockLoadPublicView.mockResolvedValue({
            ...baseView,
            seoIndexEnabled: true,
        });

        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it('seoIndexEnabled=false (default) → robots noindex/nofollow', async () => {
        mockLoadPublicView.mockResolvedValue({
            ...baseView,
            seoIndexEnabled: false,
        });

        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it('title містить тип + назву бізнесу', async () => {
        mockLoadPublicView.mockResolvedValue(baseView);
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'IvanEnko' }),
        });
        expect(meta.title).toBe('Оплата на ФОП Іваненко — Finly');
    });

    it('not found → fallback title + noindex (запобігаємо індексацію 404)', async () => {
        mockLoadPublicView.mockResolvedValue(null);
        const meta = await generateMetadata({
            params: Promise.resolve({ slug: 'missing' }),
        });
        expect(meta.title).toBe('Сторінку не знайдено — Finly');
        expect(meta.robots).toEqual({ index: false, follow: false });
    });
});
