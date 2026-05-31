import { Injectable } from '@nestjs/common';
import { join } from 'path';

import {
    build002Payload,
    build003Payload,
    buildNbuPayloadLink,
    DEFAULT_QR_SIZE_NAME,
    encodePayloadAsBase64Url,
    resolveQrSizePx,
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
 *   sizePx: `QR_SIZE_PX[DEFAULT_QR_SIZE_NAME]` — помірний екранний розмір.
 *   errorCorrection: 'Q' — норматив 003 (Додаток 4 §IV.10.4 ст. 28).
 *
 * Центр і смуги задаються **брендом** (тип-рівневий дескриптор `QrBrand`),
 * не цими опціями — це точка розширення під майбутній клієнтський шар C.
 */
export interface QrRenderOptions {
    sizePx?: number;
    errorCorrection?: QrErrorCorrectionLevel;
}

/** Формат центрального asset-у тип-2 (Sprint 14 §Q5). */
export type QrUrlCenterFormat = 'rect' | 'square';

/** Опції рендеру URL-QR (тип-2) — центр обирається з двох форматів. */
export interface QrUrlRenderOptions extends QrRenderOptions {
    /** Дефолт `'rect'` (лого + назва). `'square'` — лише лого (під шар C). */
    centerFormat?: QrUrlCenterFormat;
}

/**
 * Тип-рівневий дескриптор брендингу QR (Sprint 14). Визначає центральний
 * asset і опційні смуги. Дефолти задаються тут (BRAND_*), не у
 * низькорівневому compositor-і — це точка підміни під клієнтський брендинг
 * (шар C): платний шар замінить asset-файли й тексти, не торкаючись рендеру.
 *
 * Усі шляхи — імена файлів у `assets/` (build-time baked PNG, копіюються у
 * `dist` через nest-cli). Смуги й центральні плашки несуть бренд-кольори
 * (зелений логотип + темний `--foreground` текст), але сама матриця QR
 * лишається чорно-білою — сканованість не зачеплена. Різниця тип-1/тип-2
 * несеться структурою (центр + порядок смуг).
 */
interface QrBrand {
    centerAssetFile: string;
    centerWidthRatio: number;
    topBandFile?: string;
    bottomBandFile?: string;
}

/**
 * Тип-1 (НБУ-payload): нормативний центр (білий круг зі знаком гривні,
 * недоторканний), верхня смуга Finly (бренд-шапка), нижня смуга дрібним
 * footer-ом «Створено за стандартами НБУ». Центр-ratio 0.2 — той самий
 * нормативний safe-bound, що до Sprint 14. Порядок смуг: бренд-якір зверху,
 * compliance-підпис дрібним внизу.
 */
const BRAND_NBU: QrBrand = {
    centerAssetFile: 'hryvnia-symbol.png',
    centerWidthRatio: 0.2,
    topBandFile: 'band-finly.png',
    bottomBandFile: 'band-nbu-standard.png',
};

/**
 * Тип-2 (URL), дефолтний прямокутний центр (Finly лого + назва) + нижня смуга
 * зі слоганом, без верхньої смуги (асиметрія сама собою відрізняє від тип-1).
 *
 * **Перекриття rect == square == повний `centerWidthRatio²`-квадрат.**
 * `compose` робить `fit:'contain'` з НЕпрозорим білим background — landscape-
 * asset добивається білим до повного квадрата `(ratio·qrSize)²`, і це біле
 * поле стирає модулі QR так само, як сам логотип. Тому ratio лімітує перекриту
 * площу однаково для обох форматів — шар C, піднімаючи ratio для rect, мусить
 * тримати той самий нормативний cap (`QR_LOGO_MAX_RATIO`), що для квадрата.
 */
const BRAND_URL_RECT: QrBrand = {
    centerAssetFile: 'center-finly-rect.png',
    centerWidthRatio: 0.2,
    bottomBandFile: 'band-slogan.png',
};

/**
 * Тип-2 (URL), квадратний центр (лише лого). У UI MVP не використовується
 * (дефолт — rect), але каркас рендерить обидва формати під round-trip-тестами,
 * щоб шар C просто увімкнув вибір без переробки (Sprint 14 §Q5).
 */
const BRAND_URL_SQUARE: QrBrand = {
    centerAssetFile: 'center-finly-square.png',
    centerWidthRatio: 0.2,
    bottomBandFile: 'band-slogan.png',
};

/**
 * Опції рендеру для format 003. Host — required: норматив дозволяє два host-и
 * (`NBU_HOST_PRIMARY` / `NBU_HOST_LEGACY`), Sprint 3 рішення A2 робить вибір
 * UI-рівневим (дві кнопки на публічній сторінці), без env-перемикача.
 */
export interface QrRenderOptions003 extends QrRenderOptions {
    host: AllowedNbuPayloadLinkHost003;
}

const DEFAULT_RENDER_OPTIONS = {
    sizePx: resolveQrSizePx(DEFAULT_QR_SIZE_NAME),
    errorCorrection: 'Q' as const,
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
     * Тека з brand-asset-ами (build-time baked PNG). `__dirname` = `dist/
     * modules/qr` у production або `src/modules/qr` у dev — обидва шляхи
     * валідні (asset-и копіюються у dist через nest-cli `assets` config).
     */
    private readonly assetsDir = join(__dirname, 'assets');

    constructor(
        private readonly imageRenderer: QrImageRenderer,
        private readonly logoCompositor: QrLogoCompositor
    ) {}

    /**
     * QR тип-2 для публічної сторінки (`pay.finly.com.ua/{slug...}`): Finly-
     * центр + нижня смуга зі слоганом, без верхньої смуги. Дефолтний центр —
     * прямокутний (лого + назва); `centerFormat: 'square'` — лише лого.
     */
    async renderForUrl(
        url: string,
        options?: QrUrlRenderOptions
    ): Promise<Buffer> {
        const brand =
            options?.centerFormat === 'square'
                ? BRAND_URL_SQUARE
                : BRAND_URL_RECT;
        return this.renderBranded(url, brand, options);
    }

    /**
     * QR з NBU-payload-link для відкриття банк-додатка з заповненими
     * реквізитами. Версія 002 — fallback, 003 — основна.
     *
     * Послідовність (Додаток 3 §IV.14 / Додаток 4 §IV.10):
     *   1. build payload (Zod-валідація → field-asserts → join('\n')).
     *   2. encode Base64URL.
     *   3. wrap у `https://<host>/<b64>` (host визначається версією).
     *   4. render PNG + тип-1 брендинг (нормативний центр + смуги НБУ/Finly).
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
        return this.renderBranded(link, BRAND_NBU, options);
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

    /**
     * Спільний брендований pipeline для обох типів: render QR → центр-overlay
     * → смуги. Центр і смуги беруться з `brand`-дескриптора; розмір — з опцій
     * (whitelist `QR_SIZE_PX` резолвиться у controller-і, сюди приходить px).
     */
    private async renderBranded(
        text: string,
        brand: QrBrand,
        options?: QrRenderOptions
    ): Promise<Buffer> {
        const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
        const qrPng = await this.imageRenderer.render(text, {
            sizePx: opts.sizePx,
            errorCorrection: opts.errorCorrection,
        });
        const withCenter = await this.logoCompositor.compose(
            qrPng,
            join(this.assetsDir, brand.centerAssetFile),
            { qrSizePx: opts.sizePx, logoMaxRatio: brand.centerWidthRatio }
        );
        return this.logoCompositor.addBands(withCenter, {
            width: opts.sizePx,
            topBandPath: brand.topBandFile
                ? join(this.assetsDir, brand.topBandFile)
                : undefined,
            bottomBandPath: brand.bottomBandFile
                ? join(this.assetsDir, brand.bottomBandFile)
                : undefined,
        });
    }
}
