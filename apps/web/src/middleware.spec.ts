// Mock next/server before importing middleware
const mockRedirect = jest.fn((url: URL, status?: number) => ({
    status: status ?? 307,
    headers: new Map([['location', url.toString()]]),
}));

jest.mock('next/server', () => ({
    NextRequest: jest.fn(),
    NextResponse: {
        redirect: (url: URL, status?: number) => mockRedirect(url, status),
        next: () => ({ status: 200, headers: new Map() }),
    },
}));

import middleware, { config } from './middleware';

function createMockRequest(
    pathname: string,
    cookies: Record<string, string> = {}
) {
    const url = `http://localhost:3000${pathname}`;

    return {
        nextUrl: {
            pathname,
            search: '',
        },
        url,
        cookies: {
            has: (name: string) => name in cookies,
            get: (name: string) =>
                name in cookies ? { value: cookies[name] } : undefined,
        },
    } as any;
}

describe('middleware', () => {
    beforeEach(() => {
        mockRedirect.mockClear();
    });

    describe('protected paths', () => {
        it('redirects /profile to signin when no cookie', () => {
            const req = createMockRequest('/profile');
            const response = middleware(req);

            expect(response.status).toBe(307);
            expect(mockRedirect).toHaveBeenCalled();
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('redirects /business to signin when no cookie (Sprint 3 §3.5 — replaces /dashboard)', () => {
            const req = createMockRequest('/business');
            const response = middleware(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('redirects /business/{slug} (nested) to signin when no cookie', () => {
            const req = createMockRequest('/business/IvanEnko');
            const response = middleware(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/auth/signin');
        });

        it('Sprint 3 §3.5 §E2: /dashboard → 308 redirect на /business (legacy bookmarks)', () => {
            // Видалена сторінка, але legacy bookmarked / email / chat links
            // перенаправляємо на новий route. 308 (Permanent Redirect) —
            // browser кешує + зберігає метод; пошуковики оновлюють index.
            const req = createMockRequest('/dashboard');
            const response = middleware(req);

            expect(response.status).toBe(308);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business');
        });

        it('/dashboard/{nested} теж redirect-иться на /business/{nested}', () => {
            const req = createMockRequest('/dashboard/some-slug');
            const response = middleware(req);

            expect(response.status).toBe(308);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business/some-slug');
        });

        it('Sprint 3 §3.5 §E4: /pay видалено з PROTECTED_PATHS (мертвий рудимент)', () => {
            const req = createMockRequest('/pay');
            const response = middleware(req);

            expect(response.status).toBe(200);
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('passes through protected path when cookie exists', () => {
            const req = createMockRequest('/profile', {
                bid_refresh: 'some-token',
            });
            const response = middleware(req);

            expect(response.status).toBe(200);
            expect(mockRedirect).not.toHaveBeenCalled();
        });

        it('tags missing-cookie redirect with reason=session-expired', () => {
            const req = createMockRequest('/profile');
            middleware(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBe('session-expired');
        });

        it('does NOT tag account-deletion redirect with reason=session-expired', () => {
            // Account-deleted users have their own recovery flow on the
            // signin page; tagging this redirect would clear in-memory
            // state needed by that flow and surface a misleading toast.
            const req = createMockRequest('/profile', {
                bid_refresh: 'some-token',
                bid_account_deleted: 'true',
            });
            middleware(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBeNull();
        });

        it('does NOT tag redirect when both cookies are missing AND deletion flag set', () => {
            // Edge case: deletion flag present but no refresh cookie.
            // Deletion flow takes precedence — the user lands on signin
            // for recovery, not session-expiration handling.
            const req = createMockRequest('/profile', {
                bid_account_deleted: 'true',
            });
            middleware(req);

            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.searchParams.get('reason')).toBeNull();
        });
    });

    describe('auth paths', () => {
        it('redirects /auth/signin to /business when cookie exists (Sprint 3 §3.5 — replaces /dashboard target)', () => {
            const req = createMockRequest('/auth/signin', {
                bid_refresh: 'some-token',
            });
            const response = middleware(req);

            expect(response.status).toBe(307);
            const url: URL = mockRedirect.mock.calls[0][0];
            expect(url.pathname).toBe('/business');
        });

        it('passes through /auth/signin when no cookie', () => {
            const req = createMockRequest('/auth/signin');
            const response = middleware(req);

            expect(response.status).toBe(200);
        });
    });

    describe('public paths', () => {
        it('passes through public paths', () => {
            const req = createMockRequest('/');
            const response = middleware(req);

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
});
