import {
    BadRequestException,
    Controller,
    Get,
    GoneException,
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
import { isInvoiceExpired } from './expiry';
import { InvoicesService } from './invoices.service';
import { buildPayloadInputFromInvoice } from './payload-mapper';
import { effectiveInvoicePurpose } from './purpose-resolver';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 — public endpoints для зони `pay.finly.com.ua/{slug}/{invoiceSlug}`.
 *
 * **Окремий controller від `InvoicesController` (cabinet).** Розділення зон
 * by design (той самий патерн, що Sprint 3 `PublicBusinessesController`):
 *  - public — без guard-ів, без cookie / Authorization. На відміну від
 *    business-public, тут **без CDN-cache** (`Cache-Control: no-store`,
 *    обґрунтування нижче) — invoice mutable payment data.
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
 * **`Cache-Control: no-store`** — invoice — це mutable payment command:
 * `amount`, `paymentPurpose`, `validUntil`, lockMask і delete-state можуть
 * змінитися ФОПом у будь-який момент. Aggressive shared-cache (`public,
 * max-age=3600, SWR=86400`) у Sprint 4 створював correctness-ризик: клієнт
 * по збереженому посиланню міг отримати застарілу суму/QR після редагування
 * або взагалі бачити рахунок після видалення. Для payment flow це
 * неприйнятно. CDN-relief, якщо знадобиться у майбутньому, реалізуємо через
 * ETag-валідацію або cache-busting query (`?v={updatedAt}`), не через
 * time-based stale window. Business endpoints (vanity вивіска, immutable-ish)
 * залишаються з агресивним кешем — у `PublicBusinessesController`.
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
    @Header('Cache-Control', 'no-store')
    async getPublic(
        @Param('slug') slug: string,
        @Param('invoiceSlug') invoiceSlug: string
    ): Promise<{ data: PublicInvoiceView }> {
        const { business, invoice } = await this.lookupOrThrow(
            slug,
            invoiceSlug
        );
        const expired = isInvoiceExpired(invoice.validUntil);
        // Sprint 4 review fix — server-side expiry block. Раніше expired-
        // banner існував тільки на клієнті (client-side `getInvoiceStatus`),
        // але `nbuLinks` все одно віддавалися у JSON. Зараз: коли
        // `validUntil < now` — `nbuLinks: null`; client рендерить heading
        // + "Прострочено"-banner без жодного payment-vector-у. QR endpoints
        // у такому стані повертають 410 (defense-in-depth).
        const nbuLinks = expired
            ? null
            : (() => {
                  const payloadInput = buildPayloadInputFromInvoice(
                      business,
                      invoice
                  );
                  return {
                      primary: this.qrService.buildNbuPayloadLinkForInput(
                          payloadInput,
                          NBU_HOST_PRIMARY
                      ),
                      legacy: this.qrService.buildNbuPayloadLinkForInput(
                          payloadInput,
                          NBU_HOST_LEGACY
                      ),
                  };
              })();
        // PublicInvoiceSchema.parse — це whitelist-фільтр: усе, що не у
        // схемі, відкидається. Якщо колись Mongoose-doc отримає leak-поле
        // — це місце відрубає його перед серіалізацією.
        const view = PublicInvoiceSchema.parse({
            amount: invoice.amount,
            amountLocked: invoice.amountLocked,
            // Sprint 4 §4.7 — resolve `paymentPurpose` через
            // `effectiveInvoicePurpose` (inheritance-rule, той самий шлях що
            // `payloadInput.purpose`). Single source of truth: UI sub-info
            // блок і NBU payload показують однаковий текст.
            paymentPurpose: effectiveInvoicePurpose(
                invoice.paymentPurpose,
                business.paymentPurposeTemplate
            ),
            validUntil: invoice.validUntil,
            slug: invoice.slug,
            business: {
                type: business.type,
                name: business.name,
                slug: business.slug,
                acceptedBanks: business.acceptedBanks,
            },
            nbuLinks,
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
    @Header('Cache-Control', 'no-store')
    async getBusinessQr(
        @Param('slug') slug: string,
        @Param('invoiceSlug') invoiceSlug: string,
        @Res() res: Response
    ): Promise<void> {
        const { business, invoice } = await this.lookupOrThrow(
            slug,
            invoiceSlug
        );
        if (isInvoiceExpired(invoice.validUntil)) {
            // Defense-in-depth: client уже не показує QR-image коли nbuLinks=null,
            // але прямий запит до endpoint (cached link, scraping) має відрубатися.
            throw new GoneException({
                code: RESPONSE_CODE.INVOICE_EXPIRED,
                message: 'Invoice expired',
            });
        }
        // Канонічний URL — case-preserved business slug + invoice slug.
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${invoice.slug}`;
        const png = await this.qrService.renderForUrl(url);
        // Content-Type ставимо ВРУЧНУ після expiry-check — `@Header()`-декоратор
        // pre-apply-ить header до запуску handler-а, тож при `GoneException`
        // exception-filter пише JSON, а Content-Type залишається image/png і
        // клієнт не парсить body. Manual setHeader тут — це на success-шляху.
        res.setHeader('Content-Type', 'image/png');
        res.send(png);
    }

    /**
     * QR з NBU-payload-link (формат 003) на одну з двох норматив-allowed
     * адрес. Payload містить amount + lockMask + validUntil — сканування
     * відкриває банк-додаток з пред-заповненими реквізитами і сумою.
     */
    @SkipOnboarding()
    @Get(':invoiceSlug/qr/nbu.png')
    @Header('Cache-Control', 'no-store')
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
        if (isInvoiceExpired(invoice.validUntil)) {
            throw new GoneException({
                code: RESPONSE_CODE.INVOICE_EXPIRED,
                message: 'Invoice expired',
            });
        }
        const input = buildPayloadInputFromInvoice(business, invoice);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
        });
        // Content-Type — manual після expiry-check (див. коментар у `getBusinessQr`).
        res.setHeader('Content-Type', 'image/png');
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
