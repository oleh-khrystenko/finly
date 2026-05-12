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
        // Branch A1 — public host + root-рівнева path (`/{businessSlug}`),
        // slug ≠ reserved → rewrite на `/host-pay/{businessSlug}` (Sprint 3 §3.9).
        //
        // **Sprint 9 §SP-4 defense-in-depth — `Cache-Control: no-store`**:
        // host-pay-root робить умовний 307-redirect-at-1-Account на server-side
        // (Server Component викликає Next.js `redirect()`). Семантика залежить
        // від стану `accounts.length`, що може змінитися (ФОП додасть 2-й
        // рахунок → 1-Account redirect перестає бути коректним). Chrome
        // агресивно кешує redirect-responses in-memory. Без header на
        // rewrite-response CDN/proxy-шар може віддавати cached HTML з
        // редіректом і клієнт застрягне на застарілому шляху після зміни
        // власником стану. 307 на app-рівні + `no-store` на edge-рівні
        // гарантують, що кожен запит резолвить актуальний стан.
        const rootSlugMatch = /^\/([^/]+)$/.exec(pathname);
        if (rootSlugMatch) {
            const slug = rootSlugMatch[1]!;
            const slugLower = slug.toLowerCase();
            if (RESERVED_SLUGS_SET.has(slugLower)) {
                // Reserved (`api`, `host-pay`, `auth`, ...) — щоб ФОП не
                // взяв такий slug і не зіткнувся з рекурсивним rewrite.
                return new NextResponse(null, { status: 404 });
            }
            const response = NextResponse.rewrite(
                new URL(`/host-pay/${slug}${search}`, request.url)
            );
            response.headers.set(
                'Cache-Control',
                'no-store, no-cache, must-revalidate'
            );
            return response;
        }

        // Branch A2 — public host + 2-сегментна path (`/{businessSlug}/{accountSlug}`)
        // (Sprint 9 §SP-5 матрьошкова навігація). **Семантичний flip vs Sprint 4**:
        // раніше 2-сегментний path інтерпретувався як invoice-URL; з Sprint 9
        // нумерація інвойсів живе per-account і invoice-URL став 3-сегментним
        // (`/{biz}/{acc}/{inv}` — Branch A3). 2-сегментний path тепер означає
        // per-account вивіску.
        //
        // Reserved-check тільки на business-slug — account-slug system-generated
        // 8-char tail (`A-Za-z0-9`), не торкає reserved-list.
        const accountSlugMatch = /^\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (accountSlugMatch) {
            const businessSlug = accountSlugMatch[1]!;
            const accountSlug = accountSlugMatch[2]!;
            const businessSlugLower = businessSlug.toLowerCase();
            if (RESERVED_SLUGS_SET.has(businessSlugLower)) {
                return new NextResponse(null, { status: 404 });
            }
            return NextResponse.rewrite(
                new URL(
                    `/host-pay/${businessSlug}/${accountSlug}${search}`,
                    request.url
                )
            );
        }

        // Branch A3 — public host + 3-сегментна path
        // (`/{businessSlug}/{accountSlug}/{invoiceSlug}`) (Sprint 9 §SP-6).
        // Invoice public-URL став 3-сегментним після перенесення інвойсів під
        // account. Reserved-check тільки на business-slug; account-slug та
        // invoice-slug — system-generated рядки без обмеження на reserved-list.
        const invoiceSlugMatch = /^\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (invoiceSlugMatch) {
            const businessSlug = invoiceSlugMatch[1]!;
            const accountSlug = invoiceSlugMatch[2]!;
            const invoiceSlug = invoiceSlugMatch[3]!;
            const businessSlugLower = businessSlug.toLowerCase();
            if (RESERVED_SLUGS_SET.has(businessSlugLower)) {
                return new NextResponse(null, { status: 404 });
            }
            return NextResponse.rewrite(
                new URL(
                    `/host-pay/${businessSlug}/${accountSlug}/${invoiceSlug}${search}`,
                    request.url
                )
            );
        }

        // Branch B — public host + root `/` / 4+-segment / інші cabinet route-и
        // (`/business/foo`, `/auth/signin`). `/api/*` уже excluded matcher-ом
        // (не доходить сюди). 404 робить cabinet route-и non-addressable з
        // pay-host і обмежує public-зону трьома sigment-рівнями матрьошки.
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
