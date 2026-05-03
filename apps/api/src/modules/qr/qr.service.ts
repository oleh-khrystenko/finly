import { Injectable } from '@nestjs/common';
import { join } from 'path';

import {
    build002Payload,
    build003Payload,
    buildNbuPayloadLink,
    encodePayloadAsBase64Url,
    type AllowedNbuPayloadLinkHost003,
    type PayloadInput,
    type PayloadVersion,
} from '@finly/types';

import {
    QrImageRenderer,
    type QrErrorCorrectionLevel,
} from './renderers/qr-image.renderer';
import { QrLogoCompositor } from './renderers/qr-logo.compositor';

/**
 * Опції рендеру QR (загальні для обох public-методів).
 *
 * Дефолти узгоджені з нормативом 003 і sprint plan §2.0:
 *   sizePx: 512 — оптимальний розмір для друку візиток та екрана.
 *   errorCorrection: 'Q' — норматив 003 (Додаток 4 §IV.10.4 ст. 28).
 *   includeLogo: true — норматив-asset зі знаком гривні в центрі (Додаток 1
 *     §III.13 ст. 5). Custom-logo бізнесу — Sprint 6.
 *   logoMaxRatio: 0.2 — safe upper-bound під Q-correction (~25%).
 */
export interface QrRenderOptions {
    sizePx?: number;
    errorCorrection?: QrErrorCorrectionLevel;
    includeLogo?: boolean;
    logoMaxRatio?: number;
}

/**
 * Опції рендеру для format 003. Host — required: норматив дозволяє два host-и
 * (`NBU_HOST_PRIMARY` / `NBU_HOST_LEGACY`), Sprint 3 рішення A2 робить вибір
 * UI-рівневим (дві кнопки на публічній сторінці), без env-перемикача.
 */
export interface QrRenderOptions003 extends QrRenderOptions {
    host: AllowedNbuPayloadLinkHost003;
}

const DEFAULT_RENDER_OPTIONS = {
    sizePx: 512,
    errorCorrection: 'Q' as const,
    includeLogo: true,
    logoMaxRatio: 0.2,
};

/**
 * `QrService` — orchestrator QR-pipeline-у. Інжектиться у Sprint 3 controllers
 * (`BusinessesController`, `InvoicesController`) без змін.
 *
 * **Public API:**
 *   - `renderForUrl(url, opts)` — для **публічної сторінки бізнесу/інвойсу**:
 *     QR кодує `pay.finly.com.ua/{slug}`, що відкривається у браузері. Жодного
 *     NBU-payload — клієнт переходить на сторінку, бачить кнопки банків, оплачує.
 *
 *   - `renderForNbuPayload(input, version, opts)` — для **"Інший банк"**
 *     fallback і per-bank deep-links (Sprint 5): build NBU-payload → encode
 *     Base64URL → wrap у `https://<host>/<b64>` → render image. Цей QR
 *     ловиться банк-додатком і відкривається з реквізитами одразу.
 *
 *     Сигнатура — overload: для версії `'003'` `opts.host` обовʼязковий
 *     (TypeScript блокує виклик без host); для `'002'` host фіксований
 *     нормативом (`URL_PREFIX_002`) і параметр ігнорується.
 *
 * **Чому два різні методи**, а не один з прапором: payload generation для
 * NBU-формату має складний контракт (validate input → build → encode → host
 * whitelist), помилки якого — `PayloadValidationError`. Простий URL не має
 * цього шляху помилок — `renderForUrl` не може зловити NBU-related issue
 * випадково. Розмежування методів робить помилки локалізованими.
 */
@Injectable()
export class QrService {
    /**
     * Шлях до нормативного asset-у — білий круг зі знаком гривні (Додаток 1
     * §III.13 ст. 5 постанови НБУ № 97). Sprint 3 рішення C5: Finly-брендинг
     * живе у верстці сторінки, не в QR; центральний asset — норматив, не лого.
     * `__dirname` тут = `dist/modules/qr` у production або `src/modules/qr` у
     * dev — обидва відносні шляхи працюють однаково (asset копіюється у dist
     * через nest-cli `assets` config).
     */
    private readonly logoPath = join(
        __dirname,
        'assets',
        'hryvnia-symbol.png'
    );

    constructor(
        private readonly imageRenderer: QrImageRenderer,
        private readonly logoCompositor: QrLogoCompositor
    ) {}

    /**
     * QR для публічної сторінки бізнесу/інвойсу (`pay.finly.com.ua/{slug}`).
     */
    async renderForUrl(
        url: string,
        options?: QrRenderOptions
    ): Promise<Buffer> {
        return this.renderText(url, options);
    }

    /**
     * QR з NBU-payload-link для відкриття банк-додатка з заповненими
     * реквізитами. Версія 002 — fallback, 003 — основна.
     *
     * Послідовність (Додаток 3 §IV.14 / Додаток 4 §IV.10):
     *   1. build payload (Zod-валідація → field-asserts → join('\n')).
     *   2. encode Base64URL.
     *   3. wrap у `https://<host>/<b64>` (host визначається версією).
     *   4. render PNG + optional logo overlay.
     */
    async renderForNbuPayload(
        input: PayloadInput,
        version: '002',
        options?: QrRenderOptions
    ): Promise<Buffer>;
    async renderForNbuPayload(
        input: PayloadInput,
        version: '003',
        options: QrRenderOptions003
    ): Promise<Buffer>;
    async renderForNbuPayload(
        input: PayloadInput,
        version: PayloadVersion,
        options?: QrRenderOptions003 | QrRenderOptions
    ): Promise<Buffer> {
        const payload =
            version === '002' ? build002Payload(input) : build003Payload(input);
        const base64Url = encodePayloadAsBase64Url(payload);
        // Host пробрасуємо як undefined-safe lookup, щоб required-validation
        // лишалась у `buildNbuPayloadLink` (доменна помилка
        // `PAYLOAD_HOST_REQUIRED` з `PayloadValidationError`). Cast без
        // optional-chain тут дав би `TypeError: Cannot read properties of
        // undefined` для callsite, що обійшов TypeScript-overload (`as any` /
        // generic version-через-параметр) — нечитабельний 500 замість
        // структурованої 4xx з machine-code.
        const link =
            version === '003'
                ? buildNbuPayloadLink(version, base64Url, {
                      host: (options as QrRenderOptions003 | undefined)?.host,
                  })
                : buildNbuPayloadLink(version, base64Url);
        return this.renderText(link, options);
    }

    /**
     * Будує NBU payload-link URL без рендеру PNG. Використовується public
     * controller-ом для CTA-кнопок "Інший банк" на public-сторінці бізнесу
     * (Sprint 3 рішення A2: ОС ловить тап через app-link і відкриває банк
     * з заповненими реквізитами). Той самий pipeline що `renderForNbuPayload`,
     * без `imageRenderer.render` overhead-у — endpoint віддає JSON, не PNG.
     *
     * Версія фіксована `'003'` (рекомендована нормативом для tap-flow);
     * `host` — required параметр з whitelist (`NBU_HOST_PRIMARY` /
     * `NBU_HOST_LEGACY`).
     */
    buildNbuPayloadLinkForInput(
        input: PayloadInput,
        host: AllowedNbuPayloadLinkHost003
    ): string {
        const payload = build003Payload(input);
        const base64Url = encodePayloadAsBase64Url(payload);
        return buildNbuPayloadLink('003', base64Url, { host });
    }

    private async renderText(
        text: string,
        options?: QrRenderOptions
    ): Promise<Buffer> {
        const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
        const qrPng = await this.imageRenderer.render(text, {
            sizePx: opts.sizePx,
            errorCorrection: opts.errorCorrection,
        });
        if (!opts.includeLogo) {
            return qrPng;
        }
        return this.logoCompositor.compose(qrPng, this.logoPath, {
            qrSizePx: opts.sizePx,
            logoMaxRatio: opts.logoMaxRatio,
        });
    }
}
