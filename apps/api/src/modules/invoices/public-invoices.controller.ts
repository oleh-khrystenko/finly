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
    PublicInvoiceSchema,
    RESPONSE_CODE,
    type AllowedNbuPayloadLinkHost003,
    type PublicInvoiceView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { ENV } from '../../config/env';
import { BusinessesService } from '../businesses/businesses.service';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { QrService } from '../qr/qr.service';
import { InvoicesService } from './invoices.service';
import { buildPayloadInputFromInvoice } from './payload-mapper';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 — public endpoints для зони `pay.finly.com.ua/{slug}/{invoiceSlug}`.
 *
 * **Окремий controller від `InvoicesController` (cabinet).** Розділення зон
 * by design (той самий патерн, що Sprint 3 `PublicBusinessesController`):
 *  - public — без guard-ів, без cookie / Authorization, з агресивним CDN-cache.
 *  - cabinet — за `JwtActiveGuard` + `BusinessAccessGuard`, без CDN-cache.
 *  Спільні primitives (`BusinessesService.getBySlug` case-insensitive,
 *  `InvoicesService.getBySlug` case-sensitive) — single read-path для обох
 *  сторін.
 *
 * **Lookup chain.** Спершу business case-insensitively (slug-вивіска ФОП —
 * vanity, регістр у клієнтському посиланні може плавати); потім invoice
 * case-sensitively у межах `business._id` (SP-8: invoice-slug 99% system-
 * generated, case-insensitive lookup не дає UX-користі). 404 на будь-якому
 * з двох — той самий response shape, frontend `host-pay/[slug]/[invoiceSlug]`
 * (Sprint 4 §4.7) обробляє через `notFound()`.
 *
 * **Whitelist 7 полів у JSON-response.** `PublicInvoiceSchema.parse`
 * (Sprint 4 §4.1 — single source of truth) strip-ить leak-кандидати:
 * `requisites`, `taxationSystem`, `isVatPayer`, `ownerId`, `managers`,
 * `slugPreset`, `slugCounter*`, timestamps. Visible: invoice.{amount,
 * amountLocked, paymentPurpose, validUntil, slug}, business.{type, name,
 * slug, acceptedBanks}, nbuLinks.{primary, legacy}.
 *
 * **Реквізити leak-vector.** IBAN/ІПН не у JSON — тільки у `nbuLinks`
 * Base64URL payload (той самий інваріант, що `PublicBusinessesController`):
 * дані доступні **тільки через формати, що читаються банком як платіжна
 * команда**.
 *
 * **`@SkipOnboarding()`** — public endpoints доступні всім (включно з
 * не-залогіненими). Глобальний `OnboardingInterceptor` пропустимо явно через
 * decorator.
 *
 * **`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`** —
 * безпечно тут (немає `Authorization`/cookie; shared cache не отримає response
 * специфічний для user-а). Кеш — інвалідовується через 1 годину; SWR-вікно
 * 24 години для CDN-graceful-revalidation.
 */
@Controller('businesses/public/:slug/invoices')
export class PublicInvoicesController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly invoicesService: InvoicesService,
        private readonly qrService: QrService
    ) {}

    @SkipOnboarding()
    @Get(':invoiceSlug')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getPublic(
        @Param('slug') slug: string,
        @Param('invoiceSlug') invoiceSlug: string
    ): Promise<{ data: PublicInvoiceView }> {
        const { business, invoice } = await this.lookupOrThrow(
            slug,
            invoiceSlug
        );
        const payloadInput = buildPayloadInputFromInvoice(business, invoice);
        // PublicInvoiceSchema.parse — це whitelist-фільтр: усе, що не у
        // схемі, відкидається. Якщо колись Mongoose-doc отримає leak-поле
        // — це місце відрубає його перед серіалізацією.
        const view = PublicInvoiceSchema.parse({
            amount: invoice.amount,
            amountLocked: invoice.amountLocked,
            paymentPurpose: invoice.paymentPurpose,
            validUntil: invoice.validUntil,
            slug: invoice.slug,
            business: {
                type: business.type,
                name: business.name,
                slug: business.slug,
                acceptedBanks: business.acceptedBanks,
            },
            nbuLinks: {
                primary: this.qrService.buildNbuPayloadLinkForInput(
                    payloadInput,
                    NBU_HOST_PRIMARY
                ),
                legacy: this.qrService.buildNbuPayloadLinkForInput(
                    payloadInput,
                    NBU_HOST_LEGACY
                ),
            },
        });
        return { data: view };
    }

    /**
     * QR на public-URL інвойсу (`pay.finly.com.ua/{businessSlug}/{invoiceSlug}`).
     * Той самий "канонічний-URL"-патерн, що Sprint 3 business-QR — скан клієнтом
     * веде одразу на канонічну сторінку без 301-redirect-hop-у.
     */
    @SkipOnboarding()
    @Get(':invoiceSlug/qr/business.png')
    @Header('Content-Type', 'image/png')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getBusinessQr(
        @Param('slug') slug: string,
        @Param('invoiceSlug') invoiceSlug: string,
        @Res() res: Response
    ): Promise<void> {
        const { business, invoice } = await this.lookupOrThrow(
            slug,
            invoiceSlug
        );
        // Канонічний URL — case-preserved business slug + invoice slug.
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${invoice.slug}`;
        const png = await this.qrService.renderForUrl(url);
        res.send(png);
    }

    /**
     * QR з NBU-payload-link (формат 003) на одну з двох норматив-allowed
     * адрес. Payload містить amount + lockMask + validUntil — сканування
     * відкриває банк-додаток з пред-заповненими реквізитами і сумою.
     */
    @SkipOnboarding()
    @Get(':invoiceSlug/qr/nbu.png')
    @Header('Content-Type', 'image/png')
    @Header(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
    )
    async getNbuQr(
        @Param('slug') slug: string,
        @Param('invoiceSlug') invoiceSlug: string,
        @Query('host') hostParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const host = resolveNbuHost(hostParam);
        const { business, invoice } = await this.lookupOrThrow(
            slug,
            invoiceSlug
        );
        const input = buildPayloadInputFromInvoice(business, invoice);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
        });
        res.send(png);
    }

    /**
     * Спільний lookup-helper: bizness case-insensitive, invoice case-sensitive.
     * 404 на любому з двох — single shape для frontend-host-aware-rewrite-у
     * (`host-pay/[slug]/[invoiceSlug]`, §4.7).
     */
    private async lookupOrThrow(
        slug: string,
        invoiceSlug: string
    ): Promise<{ business: BusinessDocument; invoice: InvoiceDocument }> {
        const business = await this.businessesService.getBySlug(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        const invoice = await this.invoicesService.getBySlug(
            business._id,
            invoiceSlug
        );
        if (!invoice) {
            throw new NotFoundException({
                code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                message: 'Invoice not found',
            });
        }
        return { business, invoice };
    }
}

/**
 * Маппимо user-facing `?host=primary|legacy` → constants. Не приймаємо raw
 * host у query (`?host=qr.bank.gov.ua`) — щоб (1) public-API не leak-нув
 * деталі НБУ-нормативу клієнтам, (2) typo дав чітку помилку, не silent
 * fallback. Той самий патерн, що Sprint 3 `PublicBusinessesController`.
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
