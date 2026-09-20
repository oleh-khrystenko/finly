import { NextRequest, NextResponse } from 'next/server';
import { BILLING_RETURN_FLOW } from '@finly/types';

/**
 * Міст повернення з хостованої сторінки оплати (returnUrl).
 *
 * monobank повертає платника GET-редиректом на `redirectUrl`; провайдер може
 * змінити форму повернення (історично провайдери слали крос-сайтовий POST). Щоб не
 * залежати від методу, ведемо повернення на непахищений `/billing-return`, який
 * відповідає **303 See Other** на `/billing/success`. 303 примусово перетворює
 * наступний перехід на GET top-level navigation (несе cookie сесії, не трактується
 * App Router-ом як Server Action) і коректно рендерить сторінку успіху. POST-гілка
 * лишається захистом на випадок form-сабміт-повернення.
 *
 * Sprint 43 — прив'язка картки повертається на власну сторінку: гроші там не
 * рухаються, а результат перевірки картки ще треба дізнатись у сервера.
 */
function redirectToSuccess(request: NextRequest): NextResponse {
    const returnPath = request.nextUrl.searchParams.get('returnPath');
    const page =
        request.nextUrl.searchParams.get('flow') ===
        BILLING_RETURN_FLOW.CARD_VERIFICATION
            ? '/billing/card'
            : '/billing/success';
    // Відносний Location, а не absolute(request.url): у standalone-режимі за
    // reverse-proxy `request.url` віддає внутрішній origin контейнера (Docker
    // container-id), а не публічний host. Браузер резолвить відносний редирект
    // проти адреси, на яку зробив запит, тож хост лишається коректним за
    // будь-яким проксі (ngrok локально, nginx на проді).
    const location = returnPath
        ? `${page}?returnPath=${encodeURIComponent(returnPath)}`
        : page;
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
