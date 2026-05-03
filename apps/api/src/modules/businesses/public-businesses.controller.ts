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
import { Response } from 'express';
import {
    NBU_HOST_LEGACY,
    NBU_HOST_PRIMARY,
    PublicBusinessSchema,
    RESPONSE_CODE,
    type AllowedNbuPayloadLinkHost003,
    type PublicBusinessView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { ENV } from '../../config/env';
import { QrService } from '../qr/qr.service';
import { BusinessesService } from './businesses.service';
import { buildPayloadInputFromBusiness } from './payload-mapper';

/**
 * Sprint 3 §3.3 — public endpoints для зони `pay.finly.com.ua`.
 *
 * **Окремий controller (а не змішаний з cabinet).** Розділення зон by design:
 *  - public — без guard-ів, без cookie / Authorization, з агресивним CDN-cache
 *    (`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`).
 *  - cabinet — за `JwtActiveGuard`, без CDN-cache.
 *  Спільний service (`BusinessesService.getBySlug`) — single primitive для
 *  case-insensitive lookup; виклик ідентичний з обох сторін, але response-shape
 *  і headers відрізняються.
 *
 * **`@SkipOnboarding()`** — public endpoints доступні всім (включно з
 * не-залогіненими). Глобальний `OnboardingInterceptor` пропустимо явно через
 * decorator, щоб неавторизований request не падав з ONBOARDING_INCOMPLETE.
 *
 * **QR cache-safety.** `Cache-Control: public` безпечний тут, бо немає
 * `Authorization`/cookie — shared cache (CDN) ніколи не отримає respond, що
 * стосується конкретного user-а. На auth-роутах `Cache-Control: public` був
 * би catastrophic — CDN віддавав би чужому ФОП респонс іншого. Тому QR
 * endpoints живуть саме тут, не в cabinet (детальніше — sprint plan §3.3).
 *
 * **Whitelist 6 полів у JSON-response.** `PublicBusinessSchema` (Sprint 3
 * рішення C4 + E3 + A2) парсить document перед видачею; усе, що не у
 * whitelist (IBAN, taxId напряму, taxationSystem, isVatPayer, ownerId,
 * managers, timestamps), strip-нуто. Visible: `type`, `name`, `slug`,
 * `acceptedBanks`, `seoIndexEnabled`, `nbuLinks`.
 *
 * **Реквізити leak-vector.** IBAN/ІПН не віддаються JSON-ом напряму, але
 * `nbuLinks.primary/legacy` містять Base64URL-encoded payload, в якому
 * реквізити присутні (це **той самий vector**, що QR PNG endpoint —
 * payload-link і QR кодують ті самі дані). Whitelist інваріант не "дані
 * не доступні клієнту", а "дані доступні **тільки через формати, що
 * читаються банком як платіжна команда**" (NBU payload-link → app-link →
 * банк-додаток; QR PNG → банк-сканер). JSON-shape не дає raw IBAN/ІПН для
 * довільного автоматизованого збору без декодування Base64URL за NBU specs.
 */
@Controller('businesses/public')
export class PublicBusinessesController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly qrService: QrService
    ) {}

    @SkipOnboarding()
    @Get(':slug')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getPublic(
        @Param('slug') slug: string
    ): Promise<{ data: PublicBusinessView }> {
        const business = await this.businessesService.getBySlug(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        const payloadInput = buildPayloadInputFromBusiness(business);
        // PublicBusinessSchema.parse — це whitelist-фільтр: усе, що не у
        // схемі, відкидається. Якщо колись Mongoose-doc отримає leak-поле —
        // це місце відрубає його перед серіалізацією.
        const view = PublicBusinessSchema.parse({
            type: business.type,
            name: business.name,
            slug: business.slug,
            acceptedBanks: business.acceptedBanks,
            seoIndexEnabled: business.seoIndexEnabled,
            nbuLinks: {
                primary: this.qrService.buildNbuPayloadLinkForInput(
                    payloadInput,
                    NBU_HOST_PRIMARY,
                ),
                legacy: this.qrService.buildNbuPayloadLinkForInput(
                    payloadInput,
                    NBU_HOST_LEGACY,
                ),
            },
        });
        return { data: view };
    }

    /**
     * QR на публічну URL (`pay.finly.com.ua/{slug}`). Знак гривні в центрі.
     * Cabinet реюзає це ж URL для відображення превʼю — без auth-у, бо
     * QR-вивіска public-by-design (§3.3 cache-safety rationale).
     */
    @SkipOnboarding()
    @Get(':slug/qr/business.png')
    @Header('Content-Type', 'image/png')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getBusinessQr(
        @Param('slug') slug: string,
        @Res() res: Response
    ): Promise<void> {
        const business = await this.businessesService.getBySlug(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        // Канонічний URL — з case-preserved slug-ом, як ФОП його зафіксував.
        // Це гарантує: скан QR клієнтом веде одразу на канонічну сторінку без
        // 301-redirect-hop-у. Host — `PAY_PUBLIC_URL` (public-зона), не
        // `WEB_URL` (cabinet-зона); host-aware middleware §3.9 на cabinet
        // root-slug повертає 404, тож QR на cabinet host — broken UX.
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}`;
        const png = await this.qrService.renderForUrl(url);
        res.send(png);
    }

    /**
     * QR з NBU-payload-link (формат 003) на одну з двох норматив-allowed
     * адрес. `?host=primary` → `qr.bank.gov.ua`, `?host=legacy` →
     * `bank.gov.ua/qr` (Sprint 3 рішення A2: дві кнопки + два QR на public-сторінці).
     */
    @SkipOnboarding()
    @Get(':slug/qr/nbu.png')
    @Header('Content-Type', 'image/png')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getNbuQr(
        @Param('slug') slug: string,
        @Query('host') hostParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const host = resolveNbuHost(hostParam);

        const business = await this.businessesService.getBySlug(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }

        const input = buildPayloadInputFromBusiness(business);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
        });
        res.send(png);
    }
}

/**
 * Маппимо user-facing `?host=primary|legacy` → constants. Не приймаємо
 * raw host у query (`?host=qr.bank.gov.ua`) — щоб (1) public-API не leak-нув
 * деталі НБУ-нормативу клієнтам, (2) typo дав чітку помилку, не silent
 * fallback.
 */
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
