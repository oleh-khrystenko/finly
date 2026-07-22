import {
    BadRequestException,
    Controller,
    Get,
    Header,
    NotFoundException,
    Param,
    Query,
    Res,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
    buildPersonalizedPurpose,
    buildQrDownloadFilename,
    NBU_HOST_LEGACY,
    NBU_HOST_PRIMARY,
    PayloadValidationError,
    PersonalizationParamsSchema,
    PublicAccountViewSchema,
    RESPONSE_CODE,
    uniquePurposeMarkers,
    type AllowedNbuPayloadLinkHost003,
    type PayloadInput,
    type PersonalizedNbuLinks,
    type PublicAccountView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import {
    PERSONALIZED_CACHE_CONTROL,
    PUBLIC_PAGE_CACHE_CONTROL,
} from '../../common/http/public-cache';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
import { ENV } from '../../config/env';
import { BrandMarkCacheService } from '../businesses/brand-mark-cache.service';
import { buildPublicBrandView } from '../businesses/brand-public-view';
import { BusinessesService } from '../businesses/businesses.service';
import { resolvePublicIndexEnabled } from '../businesses/public-index-policy';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import {
    applyQrDownloadDisposition,
    isQrDownloadRequested,
    resolveQrSizePxFromQuery,
} from '../qr/qr-image-request';
import { QrService } from '../qr/qr.service';
import { AccountsService } from './accounts.service';
import {
    buildPayloadInputFromAccount,
    resolveAccountPurposeTemplate,
} from './payload-mapper';
import type { AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — public endpoints для зони `pay.finly.com.ua/{businessSlug}/
 * {accountSlug}`. Той самий patern, що Sprint 3 `PublicBusinessesController`:
 *  - без guard-ів, без cookie / Authorization.
 *  - короткий CDN-cache `PUBLIC_PAGE_CACHE_CONTROL` (сторінка revocable:
 *    видалення/slug-rent, тож без stale-while-revalidate — гасіння у межах TTL).
 *  - whitelist `PublicAccountViewSchema` strip-ить leak-кандидати.
 *  - реквізити leak-vector лише через `nbuLinks` Base64URL payload.
 *
 * **Throttle policy** — той самий `'public-payment'` 600/min/IP як Sprint 3
 * business-public. Скіп рахується від повного реєстру бакетів
 * (`skipThrottlersExcept`), а не `{ default: true }`: guard проганяє кожен
 * named-бакет на кожному роуті, тож нижчі (`qr-preview` 10/хв) тіньовили б
 * оголошені 600 до ефективних 10.
 */
@SkipThrottle(skipThrottlersExcept('public-payment'))
@Throttle({ 'public-payment': { limit: 600, ttl: 60000 } })
@Controller('businesses/public/:slug/account')
export class PublicAccountsController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly accountsService: AccountsService,
        private readonly qrService: QrService,
        private readonly brandMarkCache: BrandMarkCacheService
    ) {}

    @SkipOnboarding()
    @Get(':accountSlug')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getPublic(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string
    ): Promise<{ data: PublicAccountView }> {
        const { business, account } = await this.lookupOrThrow(
            slug,
            accountSlug
        );
        // Sprint 29 — персоналізований (податковий) отримувач: посилання не
        // можна порахувати наперед, поки платник не ввів РНОКПП/період. Тоді
        // nbuLinks = null, а фронтенд рендерить форму за `personalizationMarkers`.
        const personalizationMarkers = this.personalizationMarkersFor(
            business,
            account
        );
        const nbuLinks =
            personalizationMarkers.length > 0
                ? null
                : this.buildNbuLinks(
                      buildPayloadInputFromAccount(business, account)
                  );
        const view = PublicAccountViewSchema.parse({
            slug: account.slug,
            name: account.name,
            bankCode: account.bankCode,
            ibanMask: `•${account.iban.slice(-4)}`,
            business: {
                type: business.type,
                name: business.name,
                slug: business.slug,
                seoIndexEnabled: resolvePublicIndexEnabled(business, account),
                ...buildPublicBrandView(business),
            },
            nbuLinks,
            personalizationMarkers,
        });
        return { data: view };
    }

    /**
     * Sprint 29 — персоналізовані NBU-посилання (universal-links) для «тапни свій
     * банк» на податковій сторінці. Значення підстановки (РНОКПП/період) приходять
     * query-параметрами (щоб посилання було шерабельним). Без запису в БД.
     */
    @SkipOnboarding()
    @Throttle({ 'personalized-qr': { limit: 30, ttl: 60_000 } })
    // Скіп УСІХ інших бакетів, включно з класовим `public-payment`: guard
    // проганяє кожен named-бакет на кожному роуті, тож нижчий `qr-preview`
    // (10/min) тіньовив би 30 до ефективних 10 і давав би хибний 429 на
    // нормальному наборі форми.
    @SkipThrottle(skipThrottlersExcept('personalized-qr'))
    @Get(':accountSlug/personalized-links')
    @Header('Cache-Control', PERSONALIZED_CACHE_CONTROL)
    async getPersonalizedLinks(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Query() query: Record<string, string | undefined>
    ): Promise<{ data: PersonalizedNbuLinks }> {
        const { business, account } = await this.lookupOrThrow(
            slug,
            accountSlug
        );
        const input = this.resolvePayloadInput(business, account, query);
        return { data: { nbuLinks: this.buildNbuLinks(input) } };
    }

    /**
     * QR на public-URL рахунку (`pay.finly.com.ua/{businessSlug}/{accountSlug}`).
     * Знак гривні в центрі. Cabinet mirror-ить це ж URL для preview — без
     * auth-у, бо QR-вивіска public-by-design.
     */
    @SkipOnboarding()
    @Get(':accountSlug/qr/business.png')
    @Header('Content-Type', 'image/png')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getBusinessQr(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const { business, account } = await this.lookupOrThrow(
            slug,
            accountSlug
        );
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${account.slug}`;
        const centerMark =
            await this.brandMarkCache.getActiveCenterMark(business);
        const png = await this.qrService.renderForUrl(url, {
            sizePx,
            centerMark: centerMark ?? undefined,
        });
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(downloadParam),
            buildQrDownloadFilename('page', {
                businessSlug: business.slug,
                accountSlug: account.slug,
            })
        );
        res.send(png);
    }

    /**
     * QR з NBU-payload-link (формат 003) на одну з двох норматив-allowed
     * адрес. `?host=primary` → `qr.bank.gov.ua`, `?host=legacy` → `bank.gov.ua/qr`.
     *
     * Sprint 29 — лише для звичайних (не персоналізованих) реквізитів. Податковий
     * отримувач з маркерами йде через `qr/personalized.png` (окремий нижчий
     * rate-limit); тут маркери означали б рендер QR з літеральним `{taxId}` у
     * призначенні (зіпсований платіж) або обхід персоналізованого ліміту, тож 404.
     */
    @SkipOnboarding()
    @Get(':accountSlug/qr/nbu.png')
    @Header('Content-Type', 'image/png')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getNbuQr(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Query('host') hostParam: string | undefined,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const host = resolveNbuHost(hostParam);
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const { business, account } = await this.lookupOrThrow(
            slug,
            accountSlug
        );
        if (this.personalizationMarkersFor(business, account).length > 0) {
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Use the personalized QR endpoint for this payee',
            });
        }
        const input = buildPayloadInputFromAccount(business, account);
        await this.sendNbuPng(res, business, account, input, host, sizePx, {
            downloadParam,
        });
    }

    /**
     * Sprint 29 — персоналізований (податковий) QR: підставляє значення
     * (РНОКПП/період/ПІБ) з query у шаблон-маркери перед рендером. Значення
     * шерабельні через адресу. Без запису в БД. Окремий НИЖЧИЙ rate-limit
     * (`personalized-qr` 30/min), бо анонімний sharp-рендер з унікальними query
     * фактично не кешується — див. коментар бакета у `app.module`.
     */
    @SkipOnboarding()
    @Throttle({ 'personalized-qr': { limit: 30, ttl: 60_000 } })
    // Скіп УСІХ інших бакетів, включно з класовим `public-payment`: guard
    // проганяє кожен named-бакет на кожному роуті, тож нижчий `qr-preview`
    // (10/min) тіньовив би 30 до ефективних 10 і давав би хибний 429 на
    // нормальному наборі форми.
    @SkipThrottle(skipThrottlersExcept('personalized-qr'))
    @Get(':accountSlug/qr/personalized.png')
    @Header('Content-Type', 'image/png')
    @Header('Cache-Control', PERSONALIZED_CACHE_CONTROL)
    async getPersonalizedQr(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Query('host') hostParam: string | undefined,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Query() query: Record<string, string | undefined>,
        @Res() res: Response
    ): Promise<void> {
        const host = resolveNbuHost(hostParam);
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const { business, account } = await this.lookupOrThrow(
            slug,
            accountSlug
        );
        if (this.personalizationMarkersFor(business, account).length === 0) {
            // Роут лише для отримувачів з шаблоном-маркерами; звичайні йдуть
            // через nbu.png.
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Payee has no personalization template',
            });
        }
        const input = this.resolvePayloadInput(business, account, query);
        await this.sendNbuPng(res, business, account, input, host, sizePx, {
            downloadParam,
        });
    }

    /**
     * Спільний рендер NBU-QR (формат 003) з брендовою верхньою смугою. Sprint 21 —
     * кастомна смуга активного бренду (null → Finly); нормативний центр (знак
     * гривні) і нижня НБУ-смуга недоторкані.
     */
    private async sendNbuPng(
        res: Response,
        business: BusinessDocument,
        account: AccountDocument,
        input: PayloadInput,
        host: AllowedNbuPayloadLinkHost003,
        sizePx: number,
        opts: { downloadParam: string | undefined }
    ): Promise<void> {
        const bandMark = await this.brandMarkCache.getActiveBandMark(business);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
            sizePx,
            topBandMark: bandMark ?? undefined,
        });
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(opts.downloadParam),
            buildQrDownloadFilename(
                host === NBU_HOST_PRIMARY
                    ? 'payment-primary'
                    : 'payment-legacy',
                { businessSlug: business.slug, accountSlug: account.slug }
            )
        );
        res.send(png);
    }

    /**
     * Маркери підстановки шаблону (лише для системних отримувачів). Sprint 29 —
     * читаємо ефективний шаблон рахунку: у ГУ ДПС реквізити ЄСВ і військового
     * збору мають різні призначення, отже й різні набори маркерів.
     */
    private personalizationMarkersFor(
        business: BusinessDocument,
        account: AccountDocument
    ) {
        return business.isSystem
            ? uniquePurposeMarkers(
                  resolveAccountPurposeTemplate(business, account)
              )
            : [];
    }

    private buildNbuLinks(input: PayloadInput): {
        primary: string;
        legacy: string;
    } {
        return {
            primary: this.qrService.buildNbuPayloadLinkForInput(
                input,
                NBU_HOST_PRIMARY
            ),
            legacy: this.qrService.buildNbuPayloadLinkForInput(
                input,
                NBU_HOST_LEGACY
            ),
        };
    }

    /**
     * Sprint 29 — базовий payload з `(business, account)`, з підстановкою значень
     * персоналізації для системного отримувача з маркерами. Для звичайного
     * рахунку query ігнорується. Неповні значення → 400 `PERSONALIZATION_INCOMPLETE`;
     * невалідні (напр. РНОКПП з хибною контрольною сумою) → 400 `VALIDATION_ERROR`.
     */
    private resolvePayloadInput(
        business: BusinessDocument,
        account: AccountDocument,
        query: Record<string, string | undefined>
    ): PayloadInput {
        const input = buildPayloadInputFromAccount(business, account);
        const markers = this.personalizationMarkersFor(business, account);
        if (markers.length === 0) {
            return input;
        }
        const parsed = PersonalizationParamsSchema.safeParse(query);
        if (!parsed.success) {
            throw new BadRequestException({
                code: RESPONSE_CODE.VALIDATION_ERROR,
                message: 'Invalid personalization values',
            });
        }
        const result = buildPersonalizedPurpose(
            resolveAccountPurposeTemplate(business, account),
            parsed.data
        );
        if (!result.ok) {
            if (result.reason === 'too-long') {
                throw new BadRequestException({
                    code: RESPONSE_CODE.PERSONALIZATION_TOO_LONG,
                    message:
                        'Personalized purpose exceeds the NBU length limit',
                });
            }
            throw new BadRequestException({
                code: RESPONSE_CODE.PERSONALIZATION_INCOMPLETE,
                message: 'Personalization values are incomplete',
            });
        }
        const personalized = { ...input, purpose: result.purpose };
        this.assertPersonalizedPayloadFits(personalized);
        return personalized;
    }

    /**
     * Sprint 29 — контроль ЗАГАЛЬНОГО бюджету payload (507 B), а не лише
     * пер-полевого ліміту призначення.
     *
     * `buildPersonalizedPurpose` міряє зібране призначення проти ліміту поля
     * (420 симв. / 840 B), який у 1.65× більший за весь payload. Тому реальний
     * податковий набір (назва «ГУ ДПС у …області» + шаблон + ПІБ кирилицею +
     * період + РНОКПП) перевалює 507 B задовго до 420 символів: пер-полевий гейт
     * пропускав його, а `PayloadValidationError` вилітав уже всередині білдера,
     * і `qr/personalized.png` віддавав 400 замість картинки — платник бачив биту
     * картинку без пояснення. Пробний білд тут ловить це рівно там, де ще можна
     * повернути машинний код і показати помилку під полем.
     *
     * Міряємо build-ом, а не арифметикою «507 мінус решта полів»: довжина
     * payload-у залежить від дефолтів білдера і роздільників, тож будь-який
     * ручний підрахунок дрейфував би від нормативу. Пробуємо повний ланцюг до
     * посилання, а не лише `build003Payload`: перший, хто впирається, це не
     * 507 B сирого payload-у, а 475 символів Base64URL (експансія 4/3, тобто
     * ~356 B сирих), тож перевірка самого payload-у пропускала б набір далі.
     */
    private assertPersonalizedPayloadFits(input: PayloadInput): void {
        try {
            this.buildNbuLinks(input);
        } catch (err) {
            if (
                err instanceof PayloadValidationError &&
                (err.code === 'PAYLOAD_OVERALL_SIZE_EXCEEDED' ||
                    err.code === 'PAYLOAD_BASE64URL_SIZE_EXCEEDED')
            ) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.PERSONALIZATION_TOO_LONG,
                    message: 'Personalized payload exceeds the NBU size limit',
                });
            }
            throw err;
        }
    }

    private async lookupOrThrow(
        slug: string,
        accountSlug: string
    ): Promise<{ business: BusinessDocument; account: AccountDocument }> {
        // Sprint 14/15 — historical-slug fallback на обох рівнях. SC порівнює
        // `params.slug !== view.business.slug` і `params.accountSlug !==
        // view.slug` (account-page) і робить один `permanentRedirect()` на
        // повний canonical URL. Account-slug тепер редаговуваний (Sprint 15),
        // тому теж має history-fallback.
        const business =
            await this.businessesService.getBySlugOrHistorical(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        const account = await this.accountsService.getBySlugOrHistorical(
            business._id,
            accountSlug
        );
        if (!account) {
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Account not found',
            });
        }
        return { business, account };
    }
}

function resolveNbuHost(
    hostParam: string | undefined
): AllowedNbuPayloadLinkHost003 {
    if (hostParam === 'primary') return NBU_HOST_PRIMARY;
    if (hostParam === 'legacy') return NBU_HOST_LEGACY;
    throw new BadRequestException({
        code: RESPONSE_CODE.VALIDATION_ERROR,
        message: 'Query param "host" must be "primary" or "legacy"',
    });
}
