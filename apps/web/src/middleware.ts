import { NextRequest, NextResponse } from 'next/server';

// Sprint 3 §3.5 — `/dashboard` видалена (E2: → `/business`); `/pay`
// видалений як рудимент (E4: піддомен `pay.finly.com.ua` — окрема історія
// host-aware routing-у §3.9, не protected path).
const PROTECTED_PATHS = ['/business', '/ai-chat', '/profile', '/billing'];
const AUTH_PATHS = ['/auth/signin'];
const COOKIE_NAME = 'bid_refresh';
const DELETED_COOKIE = 'bid_account_deleted';

export default function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const hasRefreshCookie = request.cookies.has(COOKIE_NAME);

    // Sprint 3 §3.5 — legacy `/dashboard` deep-link redirect → `/business`.
    // Не блокатор Sprint 3 (TPM-зауваження приймає 404 для bookmarked links,
    // бо deploy-ів post-Sprint-1 не було), але safer-default: збережемо
    // bookmarks, що могли потрапити у пошту/чат до full-grep cleanup-у.
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
        const url = new URL(
            pathname.replace(/^\/dashboard/, '/business') + search,
            request.url,
        );
        return NextResponse.redirect(url, 308);
    }

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
        return NextResponse.redirect(new URL('/business', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
