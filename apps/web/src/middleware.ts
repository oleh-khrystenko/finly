import { NextRequest, NextResponse } from 'next/server';
import { RESERVED_SLUGS } from '@finly/types';
import { isPublicHost } from '@/shared/config/publicHosts';

// Sprint 3 §3.5 — `/dashboard` видалена (E2: → `/business`); `/pay`
// видалений як рудимент (E4: піддомен `pay.finly.com.ua` — окрема історія
// host-aware routing-у §3.9, не protected path).
const PROTECTED_PATHS = ['/business', '/ai-chat', '/profile', '/billing'];
const AUTH_PATHS = ['/auth/signin'];
const COOKIE_NAME = 'bid_refresh';
const DELETED_COOKIE = 'bid_account_deleted';

// Set для O(1) reserved-slug lookup. RESERVED_SLUGS уже у lowercase
// (контракт `packages/types/src/constants/reserved-slugs.ts`); вхід
// нормалізується до lowercase перед перевіркою.
const RESERVED_SLUGS_SET: ReadonlySet<string> = new Set(RESERVED_SLUGS);

export default function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const host = request.headers.get('host');
    // Host comparison case-insensitive — RFC 7230 §2.7. Деталі у
    // `shared/config/publicHosts.ts > isPublicHost`.
    const isPublicHostReq = isPublicHost(host);

    // ─── Sprint 3 §3.9 — host-aware routing (Branch A/B/C) ───
    //
    // Виконується ПЕРЕД cabinet logic: public-зона має повністю ізольований
    // контракт; жоден `/business`, `/auth/...`, `/profile` на public host
    // не повинен дати валідну відповідь.

    // Branch C — cabinet host + path under `/host-pay/` → 404.
    // Захист від direct-URL-input у адресний рядок (`finly.com.ua/host-pay/test`).
    // Робить `host-pay/...` non-addressable з cabinet domain.
    if (!isPublicHostReq && pathname.startsWith('/host-pay/')) {
        return new NextResponse(null, { status: 404 });
    }

    if (isPublicHostReq) {
        // Branch A1 — public host + root-рівнева path (`/{slug}`),
        // slug ≠ reserved → rewrite на `/host-pay/{slug}` (Sprint 3 §3.9).
        const rootSlugMatch = /^\/([^/]+)$/.exec(pathname);
        if (rootSlugMatch) {
            const slug = rootSlugMatch[1]!;
            const slugLower = slug.toLowerCase();
            if (RESERVED_SLUGS_SET.has(slugLower)) {
                // Reserved (`api`, `host-pay`, `auth`, ...) — щоб ФОП не
                // взяв такий slug і не зіткнувся з рекурсивним rewrite.
                return new NextResponse(null, { status: 404 });
            }
            return NextResponse.rewrite(
                new URL(`/host-pay/${slug}${search}`, request.url)
            );
        }

        // Branch A2 — public host + 2-сегментна path (`/{businessSlug}/{invoiceSlug}`)
        // (Sprint 4 §4.7). Reserved-check тільки на business-slug; invoice-slug —
        // будь-який валідний string (compound-unique-blocked у БД per-business).
        const invoiceSlugMatch = /^\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (invoiceSlugMatch) {
            const businessSlug = invoiceSlugMatch[1]!;
            const invoiceSlug = invoiceSlugMatch[2]!;
            const businessSlugLower = businessSlug.toLowerCase();
            if (RESERVED_SLUGS_SET.has(businessSlugLower)) {
                return new NextResponse(null, { status: 404 });
            }
            return NextResponse.rewrite(
                new URL(
                    `/host-pay/${businessSlug}/${invoiceSlug}${search}`,
                    request.url
                )
            );
        }

        // Branch B — public host + non-root, non-2-segment path. `/api/*` уже
        // excluded matcher-ом (не доходить сюди). Все інше (`/business/foo`,
        // `/auth/signin`, root `/`, 3+-segment) → 404. Робить cabinet route-и
        // non-addressable з pay-host.
        return new NextResponse(null, { status: 404 });
    }

    // ─── Cabinet host — existing logic ───

    const hasRefreshCookie = request.cookies.has(COOKIE_NAME);

    // Sprint 3 §3.5 — legacy `/dashboard` deep-link redirect → `/business`.
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
        const url = new URL(
            pathname.replace(/^\/dashboard/, '/business') + search,
            request.url
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
