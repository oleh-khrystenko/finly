// Mock next/server before importing proxy
const mockRedirect = jest.fn((url: URL, status?: number) => ({
    type: 'redirect' as const,
    status: status ?? 307,
    headers: new Map([['location', url.toString()]]),
    url,
}));
const mockRewrite = jest.fn((url: URL) => ({
    type: 'rewrite' as const,
    status: 200,
    headers: new Map([['x-middleware-rewrite', url.toString()]]),
    url,
}));
class MockNextResponse {
    status: number;
    body: BodyInit | null;
    constructor(body: BodyInit | null, init?: { status?: number }) {
        this.body = body;
        this.status = init?.status ?? 200;
    }
}

jest.mock('next/server', () => ({
    NextRequest: jest.fn(),
    NextResponse: Object.assign(
        function (body: BodyInit | null, init?: { status?: number }) {
            return new MockNextResponse(body, init);
        },
        {
            redirect: (url: URL, status?: number) => mockRedirect(url, status),
            rewrite: (url: URL) => mockRewrite(url),
            next: () => ({ status: 200, headers: new Map() }),
        }
    ),
}));

import proxy, { config } from './proxy';

function createMockRequest(
    pathname: string,
    options: {
        cookies?: Record<string, string>;
        host?: string;
        search?: string;
    } = {}
) {
    const cookies = options.cookies ?? {};
    const host = options.host ?? 'localhost:3000';
    const search = options.search ?? '';
    const url = `http://${host}${pathname}${search}`;

    return {
        nextUrl: {
            pathname,
            search,
        },
        url,
        headers: {
            get: (name: string) =>
                name.toLowerCase() === 'host' ? host : null,
        },
        cookies: {
            has: (name: string) => name in cookies,
            get: (name: string) =>
                name in cookies ? { value: cookies[name] } : undefined,
        },
    } as any;
}

describe('proxy', () => {
    beforeEach(() => {
        mockRedirect.mockClear();
    });

    describe('protected paths', () => {
        it('redirects /profile to signin when no cookie', () => {
            const req = createMockRequest('/profile');
            const response = proxy(req);

            expect(response.status).toBe(307);
            expect(mockRedirect).toHaveBeenCalled();
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('redirects /business to signin when no cookie (Sprint 3 §3.5 — replaces /dashboard)', () => {
            const req = createMockRequest('/business');
            const response = proxy(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('redirects /business/{slug} (nested) to signin when no cookie', () => {
            const req = createMockRequest('/business/IvanEnko');
            const response = proxy(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('Sprint 3 §3.5 §E2: /dashboard → 308 redirect на /business (legacy bookmarks)', () => {
            // Видалена сторінка, але legacy bookmarked / email / chat links
            // перенаправляємо на новий route. 308 (Permanent Redirect) —
            // browser кешує + зберігає метод; пошуковики оновлюють index.
            const req = createMockRequest('/dashboard');
            const response = proxy(req);

            expect(response.status).toBe(308);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business');
        });

        it('/dashboard/{nested} теж redirect-иться на /business/{nested}', () => {
            const req = createMockRequest('/dashboard/some-slug');
            const response = proxy(req);

            expect(response.status).toBe(308);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business/some-slug');
        });

        it('Sprint 3 §3.5 §E4: /pay видалено з PROTECTED_PATHS (мертвий рудимент)', () => {
            const req = createMockRequest('/pay');
            const response = proxy(req);

            expect(response.status).toBe(200);
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('passes through protected path when cookie exists', () => {
            const req = createMockRequest('/profile', {
                cookies: { bid_refresh: 'some-token' },
            });
            const response = proxy(req);

            expect(response.status).toBe(200);
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('tags missing-cookie redirect with reason=session-expired', () => {
            const req = createMockRequest('/profile');
            proxy(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBe('session-expired');
        });

        it('does NOT tag account-deletion redirect with reason=session-expired', () => {
            // Account-deleted users have their own recovery flow on the
            // signin page; tagging this redirect would clear in-memory
            // state needed by that flow and surface a misleading toast.
            const req = createMockRequest('/profile', {
                cookies: {
                    bid_refresh: 'some-token',
                    bid_account_deleted: 'true',
                },
            });
            proxy(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBeNull();
        });

        it('does NOT tag redirect when both cookies are missing AND deletion flag set', () => {
            // Edge case: deletion flag present but no refresh cookie.
            // Deletion flow takes precedence — the user lands on signin
            // for recovery, not session-expiration handling.
            const req = createMockRequest('/profile', {
                cookies: { bid_account_deleted: 'true' },
            });
            proxy(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBeNull();
        });
    });

    describe('auth paths', () => {
        it('redirects /auth/signin to /business when cookie exists (Sprint 3 §3.5 — replaces /dashboard target)', () => {
            const req = createMockRequest('/auth/signin', {
                cookies: { bid_refresh: 'some-token' },
            });
            const response = proxy(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business');
        });

        it('passes through /auth/signin when no cookie', () => {
            const req = createMockRequest('/auth/signin');
            const response = proxy(req);

            expect(response.status).toBe(200);
        });
    });

    describe('public paths', () => {
        it('passes through public paths', () => {
            const req = createMockRequest('/');
            const response = proxy(req);

            expect(response.status).toBe(200);
        });
    });

    describe('matcher config', () => {
        it('excludes api, _next, and file paths', () => {
            expect(config.matcher).toBe(
                '/((?!api|trpc|_next|_vercel|.*\\..*).*)'
            );
        });
    });

    // ─── Sprint 3 §3.9 — host-aware routing (Branch A/B/C) ───
    // Усі 6 кейсів з sprint plan §3.9 для повного покриття host-isolation.

    describe('host-aware routing (§3.9)', () => {
        beforeEach(() => {
            mockRedirect.mockClear();
            mockRewrite.mockClear();
        });

        it('1. host=pay.finly.com.ua + /IvanEnko → rewrite на /host-pay/IvanEnko (Branch A)', () => {
            const req = createMockRequest('/IvanEnko', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/IvanEnko');
        });

        it('1a. dev host pay.finly.local:3000 теж rewrite-иться (Branch A)', () => {
            const req = createMockRequest('/IvanEnko', {
                host: 'pay.finly.local:3000',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/IvanEnko');
        });

        it('1b. case-preserved у rewrite — slug `CamelCase` не нормалізується до lowercase', () => {
            const req = createMockRequest('/CamelCase', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/CamelCase');
        });

        it('2. host=cabinet (finly.com.ua) + /IvanEnko → НЕ rewrite (Branch A не triggers)', () => {
            // Cabinet host + slug-look-alike → middleware не rewrite-ить;
            // далі стандартний Next.js routing → 404 (немає route /IvanEnko
            // на cabinet host). У middleware це NextResponse.next() (status 200
            // у моку); реальний 404 рендериться Next.js downstream.
            const req = createMockRequest('/IvanEnko', {
                host: 'finly.com.ua',
            });
            const response = proxy(req);

            expect(mockRewrite).not.toHaveBeenCalled();
            expect(response.status).toBe(200); // pass-through до Next router
        });

        it('3. host=cabinet + /host-pay/test → 404 (Branch C — direct-URL-attack захист)', () => {
            const req = createMockRequest('/host-pay/test', {
                host: 'finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('4. host=pay + /business/foo → 404 (Branch B: cabinet route на public host)', () => {
            const req = createMockRequest('/business/foo', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('4a. host=pay + /auth/signin → 404 (Branch B: auth не доступний на pay-host)', () => {
            const req = createMockRequest('/auth/signin', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
        });

        it('4b. host=pay + root `/` → rewrite на /host-pay (Branch A0: пояснювач)', () => {
            const req = createMockRequest('/', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay');
        });

        it('5. host=pay + /api/businesses/public/foo → matcher excludes (pass-through до Next)', () => {
            // matcher config `/((?!api|trpc|_next|_vercel|.*\\..*).*)` не
            // тригерить middleware на /api/* — Next.js rewrites direct-проксує
            // на api backend. Цей тест документує контракт: middleware
            // **ніколи не запускається** на /api/*; реальна перевірка — у
            // Next.js framework-рівні (config.matcher).
            expect(config.matcher).toContain('?!api');
        });

        it('6. cookie isolation — bid_refresh на pay-host НЕ ставиться (домен finly.com.ua only)', () => {
            // Інваріант із Sprint 3 §A1: cookie ставиться на cabinet-host
            // без `Domain=` атрибуту, тож на pay-host.cookies.has() === false.
            // Mock-test: створюємо request без bid_refresh для pay-host,
            // middleware не падає на cabinet-protected logic (бо Branch B
            // вже зреагував для non-root pay-host paths).
            const req = createMockRequest('/IvanEnko', {
                host: 'pay.finly.com.ua',
                // навмисно немає cookies — symбулює реальний browser-state
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalled();
            // Жоден signin-redirect (з cabinet flow) не тригерився
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('7. Reserved slug на pay-host → 404 (захист від рекурсивного rewrite)', () => {
            // Slug `host-pay` зарезервовано (§3.1) — без цього
            // pay.finly.com.ua/host-pay рекурсивно rewrite-нувся б на
            // /host-pay/host-pay і дав би заплутаний 404.
            const req = createMockRequest('/host-pay', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('7a. Reserved slug case-insensitive — /API на pay-host теж 404', () => {
            const req = createMockRequest('/API', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('8. Host comparison case-insensitive — PAY.FINLY.COM.UA тригерить Branch A (RFC 7230 §2.7)', () => {
            // Регресія host-isolation: якщо middleware exact-eq compare-ить
            // host, UPPER/mixed case обходив Branch B/A і потрапляв у
            // cabinet pass-through. Тепер — нормалізація через
            // `isPublicHost` lowercase.
            const req = createMockRequest('/IvanEnko', {
                host: 'PAY.FINLY.COM.UA',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/IvanEnko');
        });

        it('8a. UPPER pay-host + /auth/signin → 404 (Branch B на UPPER теж triggers)', () => {
            const req = createMockRequest('/auth/signin', {
                host: 'PAY.FINLY.COM.UA',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        // ─── Sprint 9 §SP-4 — Branch A1 додає Cache-Control header ───

        it('Branch A1 ставить `Cache-Control: no-store, no-cache, must-revalidate` на rewrite (§SP-4 defense-in-depth для 1-Account-redirect-flip)', () => {
            // 307-redirect-at-1-Account живе у Server Component
            // (`host-pay/[slug]/page.tsx`). Якщо CDN/proxy шар закешує
            // redirect-response — ФОП, який додав 2-й рахунок, не зможе
            // показати клієнту новий список (cached response продовжить
            // редіректити). `no-store` на rewrite-response гарантує fresh
            // resolution на кожен hit.
            const req = createMockRequest('/IvanEnko', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.headers.get('Cache-Control')).toBe(
                'no-store, no-cache, must-revalidate'
            );
        });

        // ─── Sprint 9 §SP-5 — A2 семантичний flip (invoice-URL → account-URL) ───

        it('9. host=pay + /IvanEnko/{accountSlug} → rewrite на /host-pay/IvanEnko/{accountSlug} (Branch A2 — account-URL, Sprint 9 §SP-5)', () => {
            // Sprint 4 §4.7 був invoice-URL; Sprint 9 §SP-5 матрьошкова
            // навігація переніс інвойс на 3-сегментний path (Branch A3),
            // 2-сегментний path тепер account-URL.
            const req = createMockRequest('/IvanEnko/aBc12345', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/IvanEnko/aBc12345');
        });

        it('9a. case-preserved у обох сегментах rewrite (business + account)', () => {
            const req = createMockRequest('/IvanEnko/AbCdEfGh', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe('/host-pay/IvanEnko/AbCdEfGh');
        });

        it('10. host=pay + reserved business-slug + account-slug → 404 (reserved-check на 1-му сегменті)', () => {
            const req = createMockRequest('/business/aBc12345', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('11. host=cabinet + /host-pay/biz/acc → 404 (Branch C: 2-segment direct-URL-attack захист)', () => {
            const req = createMockRequest('/host-pay/IvanEnko/aBc12345', {
                host: 'finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        // ─── Sprint 9 §SP-6 — Branch A3 (3-сегментний invoice-URL) ───

        it('Branch A3: host=pay + /IvanEnko/aBc12345/inv-001 → rewrite на /host-pay/IvanEnko/aBc12345/inv-001 (Sprint 9 §SP-6)', () => {
            const req = createMockRequest('/IvanEnko/aBc12345/inv-001', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            expect(mockRewrite).toHaveBeenCalledTimes(1);
            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe(
                '/host-pay/IvanEnko/aBc12345/inv-001'
            );
        });

        it('Branch A3 case-preserved у всіх 3 сегментах', () => {
            const req = createMockRequest('/IvanEnko/AbCdEfGh/Inv-Vanity', {
                host: 'pay.finly.com.ua',
            });
            proxy(req);

            const url: URL = mockRewrite.mock.calls[0][0];
            expect(url.pathname).toBe(
                '/host-pay/IvanEnko/AbCdEfGh/Inv-Vanity'
            );
        });

        it('Branch A3 + reserved business-slug → 404', () => {
            const req = createMockRequest('/business/aBc12345/inv-001', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });

        it('Branch A3 НЕ ставить Cache-Control (state стабільний — fresh-redirect-flip лише на A1)', () => {
            const req = createMockRequest('/IvanEnko/aBc12345/inv-001', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.headers.get('Cache-Control')).toBeUndefined();
        });

        it('12. host=pay + 4-сегментна path → 404 (Branch B fall-through; немає 4-segment routes у public-зоні)', () => {
            const req = createMockRequest('/biz/acc/inv/extra', {
                host: 'pay.finly.com.ua',
            });
            const response = proxy(req);

            expect(response.status).toBe(404);
            expect(mockRewrite).not.toHaveBeenCalled();
        });
    });
});
