import { NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

const PROTECTED_PATHS = ['/dashboard', '/ai-chat', '/profile', '/pay', '/billing'];
const AUTH_PATHS = ['/auth/signin'];
const COOKIE_NAME = 'bid_refresh';
const DELETED_COOKIE = 'bid_account_deleted';

const localePattern = new RegExp(`^/(${routing.locales.join('|')})(/.*)?$`);

function stripLocale(pathname: string): string {
    const match = pathname.match(localePattern);
    return match?.[2] || '/';
}

export default function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const path = stripLocale(pathname);
    const hasRefreshCookie = request.cookies.has(COOKIE_NAME);
    const locale = pathname.match(localePattern)?.[1] || routing.defaultLocale;

    const isProtected = PROTECTED_PATHS.some(
        (p) => path === p || path.startsWith(`${p}/`)
    );

    const isAccountDeleted = request.cookies.has(DELETED_COOKIE);

    if (isProtected && (!hasRefreshCookie || isAccountDeleted)) {
        const signinUrl = new URL(`/${locale}/auth/signin`, request.url);

        // Tag genuine session-expiration redirects so the client can
        // clear stale in-memory user state on arrival. Account-deletion
        // redirects are NOT tagged — they have their own recovery flow
        // on the signin page and must not trigger the "session expired"
        // toast or clear the in-memory recovery context.
        if (!hasRefreshCookie && !isAccountDeleted) {
            signinUrl.searchParams.set('reason', 'session-expired');
        }

        return NextResponse.redirect(signinUrl);
    }

    const isAuthPath = AUTH_PATHS.some(
        (p) => path === p || path.startsWith(`${p}/`)
    );

    if (isAuthPath && hasRefreshCookie && !isAccountDeleted) {
        return NextResponse.redirect(
            new URL(`/${locale}/dashboard`, request.url)
        );
    }

    return intlMiddleware(request);
}

export const config = {
    matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
