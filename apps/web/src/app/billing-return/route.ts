import { NextRequest, NextResponse } from 'next/server';

/**
 * Міст повернення з хостованої сторінки оплати (returnUrl).
 *
 * monobank повертає платника GET-редиректом на `redirectUrl`; провайдер може
 * змінити форму повернення (WayForPay історично слав крос-сайтовий POST). Щоб не
 * залежати від методу, ведемо повернення на непахищений `/billing-return`, який
 * відповідає **303 See Other** на `/billing/success`. 303 примусово перетворює
 * наступний перехід на GET top-level navigation (несе cookie сесії, не трактується
 * App Router-ом як Server Action) і коректно рендерить сторінку успіху. POST-гілка
 * лишається захистом на випадок form-сабміт-повернення.
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
