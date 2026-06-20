import { NextRequest, NextResponse } from 'next/server';

/**
 * Міст повернення з WayForPay (returnUrl).
 *
 * WayForPay повертає платника на returnUrl авто-сабмітом форми, тобто
 * **крос-сайтовим POST**. Це створює два дефекти, якщо вести POST прямо на
 * сторінку `/billing/success`:
 *   1. App Router трактує POST на сторінку (`page.tsx`) як виклик Server
 *      Action і, не знайшовши його, віддає "Server action not found".
 *   2. Крос-сайтовий POST не несе `bid_refresh` (SameSite=Lax), тож `proxy.ts`
 *      вважає сесію простроченою і робить 307-redirect на
 *      `/auth/signin?reason=session-expired` (307 зберігає метод → знову POST
 *      на сторінку → знову "Server action not found").
 *
 * Цей route-handler ловить POST/GET на непахищеному шляху `/billing-return` і
 * відповідає **303 See Other** на `/billing/success`. 303 примусово
 * перетворює наступний перехід на GET (top-level navigation), який уже несе
 * cookie сесії й коректно рендерить сторінку успіху.
 */
function redirectToSuccess(request: NextRequest): NextResponse {
    const returnPath = request.nextUrl.searchParams.get('returnPath');
    const target = new URL('/billing/success', request.url);
    if (returnPath) {
        target.searchParams.set('returnPath', returnPath);
    }
    return NextResponse.redirect(target, 303);
}

export function POST(request: NextRequest): NextResponse {
    return redirectToSuccess(request);
}

export function GET(request: NextRequest): NextResponse {
    return redirectToSuccess(request);
}
