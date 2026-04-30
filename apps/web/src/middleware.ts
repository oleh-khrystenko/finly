import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/dashboard', '/ai-chat', '/profile', '/pay', '/billing'];
const AUTH_PATHS = ['/auth/signin'];
const COOKIE_NAME = 'bid_refresh';
const DELETED_COOKIE = 'bid_account_deleted';

export default function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const hasRefreshCookie = request.cookies.has(COOKIE_NAME);

    const isProtected = PROTECTED_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`)
    );

    const isAccountDeleted = request.cookies.has(DELETED_COOKIE);

    if (isProtected && (!hasRefreshCookie || isAccountDeleted)) {
        const signinUrl = new URL('/auth/signin', request.url);

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
        (p) => pathname === p || pathname.startsWith(`${p}/`)
    );

    if (isAuthPath && hasRefreshCookie && !isAccountDeleted) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
