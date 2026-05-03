import { Injectable } from '@nestjs/common';
import { join } from 'path';

import {
    build002Payload,
    build003Payload,
    buildNbuPayloadLink,
    encodePayloadAsBase64Url,
    type PayloadInput,
    type PayloadVersion,
} from '@finly/types';

import { ENV } from '../../config/env';
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
 *   includeLogo: true — Finly-лого в центрі (норматив вимагає знак гривні
 *     для 002/003 — Додаток 1 §III.13 ст. 5).
 *   logoMaxRatio: 0.2 — safe upper-bound під Q-correction (~25%).
 */
export interface QrRenderOptions {
    sizePx?: number;
    errorCorrection?: QrErrorCorrectionLevel;
    includeLogo?: boolean;
    logoMaxRatio?: number;
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
 *     Base64URL → wrap у `https://qr.bank.gov.ua/<b64>` → render image. Цей QR
 *     ловиться банк-додатком і відкривається з реквізитами одразу.
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
     * Шлях до Finly-лого. У production NestJS компілює до `dist/`, asset
     * копіюється туди ж через nest-cli `assets` config. `__dirname` тут =
     * `dist/modules/qr` у production або `src/modules/qr` у dev — обидва
     * відносні шляхи працюють однаково.
     */
    private readonly logoPath = join(__dirname, 'assets', 'finly-logo-qr.png');

    constructor(
        private readonly imageRenderer: QrImageRenderer,
        private readonly logoCompositor: QrLogoCompositor
    ) {}

    /**
     * QR для публічної сторінки бізнесу/інвойсу (`pay.finly.com.ua/{slug}`).
     *
     * Sprint 3 буде передавати готовий URL зі slug-генератора. Sprint 2 не
     * генерує сам URL — лише пакує його у QR-картинку.
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
        version: PayloadVersion,
        options?: QrRenderOptions
    ): Promise<Buffer> {
        const payload =
            version === '002' ? build002Payload(input) : build003Payload(input);
        const base64Url = encodePayloadAsBase64Url(payload);
        const link = buildNbuPayloadLink(version, base64Url, {
            host: ENV.NBU_PAYLOAD_LINK_HOST,
        });
        return this.renderText(link, options);
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
