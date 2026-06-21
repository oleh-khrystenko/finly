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
    // Відносний Location, а не absolute(request.url): у standalone-режимі за
    // reverse-proxy `request.url` віддає внутрішній origin контейнера (Docker
    // container-id), а не публічний host. Браузер резолвить відносний редирект
    // проти адреси, на яку зробив запит, тож хост лишається коректним за
    // будь-яким проксі (ngrok локально, nginx на проді).
    const location = returnPath
        ? `/billing/success?returnPath=${encodeURIComponent(returnPath)}`
        : '/billing/success';
    return new NextResponse(null, {
        status: 303,
        headers: { Location: location },
    });
}

export function POST(request: NextRequest): NextResponse {
    return redirectToSuccess(request);
}

export function GET(request: NextRequest): NextResponse {
    return redirectToSuccess(request);
}
