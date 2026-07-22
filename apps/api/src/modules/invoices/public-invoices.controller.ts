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
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
    buildQrDownloadFilename,
    NBU_HOST_LEGACY,
    NBU_HOST_PRIMARY,
    PublicInvoiceSchema,
    RESPONSE_CODE,
    type AllowedNbuPayloadLinkHost003,
    type PublicInvoiceView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
import { ENV } from '../../config/env';
import { AccountsService } from '../accounts/accounts.service';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import { BrandMarkCacheService } from '../businesses/brand-mark-cache.service';
import { buildPublicBrandView } from '../businesses/brand-public-view';
import { BusinessesService } from '../businesses/businesses.service';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import {
    applyQrDownloadDisposition,
    isQrDownloadRequested,
    resolveQrSizePxFromQuery,
} from '../qr/qr-image-request';
import { QrService } from '../qr/qr.service';
import { isInvoiceExpired } from './expiry';
import { InvoicesService } from './invoices.service';
import { buildPayloadInputFromInvoice } from './payload-mapper';
import { resolveAccountPurposeTemplate } from '../accounts/payload-mapper';
import { effectiveInvoicePurpose } from './purpose-resolver';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.3 + Sprint 9 §9.1 — public endpoints для зони
 * `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}`.
 *
 * Lookup chain: business case-insensitive → account case-sensitive `(businessId,
 * slug)` → invoice case-sensitive `(accountId, slug)`. 404 на кожному кроці.
 *
 * **Whitelist 8 полів** (Sprint 9 розширення з 7): додано `account: {slug, name,
 * bankCode, ibanMask}` (`PublicAccountListItemSchema` reuse).
 *
 * **`Cache-Control: no-store`** — invoice mutable payment command. CDN-cache
 * створив би drift на edit/delete.
 */
@SkipThrottle(skipThrottlersExcept('public-payment'))
@Throttle({ 'public-payment': { limit: 600, ttl: 60000 } })
@Controller('businesses/public/:slug/account/:accountSlug/invoices')
export class PublicInvoicesController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly accountsService: AccountsService,
        private readonly invoicesService: InvoicesService,
        private readonly qrService: QrService,
        private readonly brandMarkCache: BrandMarkCacheService
    ) {}

    @SkipOnboarding()
    @Get(':invoiceSlug')
    @Header('Cache-Control', 'no-store')
    async getPublic(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Param('invoiceSlug') invoiceSlug: string
    ): Promise<{ data: PublicInvoiceView }> {
        const { business, account, invoice } = await this.lookupOrThrow(
            slug,
            accountSlug,
            invoiceSlug
        );
        const expired = isInvoiceExpired(invoice.validUntil);
        const nbuLinks = expired
            ? null
            : (() => {
                  const payloadInput = buildPayloadInputFromInvoice(
                      business,
                      account,
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
        const snapshot = invoice.payeeSnapshot;
        const view = PublicInvoiceSchema.parse({
            amount: invoice.amount,
            amountLocked: invoice.amountLocked,
            paymentPurpose:
                snapshot?.paymentPurpose ??
                effectiveInvoicePurpose(
                    invoice.paymentPurpose,
                    resolveAccountPurposeTemplate(business, account)
                ),
            validUntil: invoice.validUntil,
            slug: invoice.slug,
            business: {
                type: business.type,
                name: snapshot?.recipientName ?? business.name,
                slug: business.slug,
                ...buildPublicBrandView(business),
            },
            account: {
                slug: account.slug,
                name: account.name,
                bankCode: account.bankCode,
                ibanMask: `•${account.iban.slice(-4)}`,
            },
            nbuLinks,
        });
        return { data: view };
    }

    @SkipOnboarding()
    @Get(':invoiceSlug/qr/business.png')
    @Header('Cache-Control', 'no-store')
    async getBusinessQr(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Param('invoiceSlug') invoiceSlug: string,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const { business, account, invoice } = await this.lookupOrThrow(
            slug,
            accountSlug,
            invoiceSlug
        );
        if (isInvoiceExpired(invoice.validUntil)) {
            throw new GoneException({
                code: RESPONSE_CODE.INVOICE_EXPIRED,
                message: 'Invoice expired',
            });
        }
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${account.slug}/${invoice.slug}`;
        const centerMark =
            await this.brandMarkCache.getActiveCenterMark(business);
        const png = await this.qrService.renderForUrl(url, {
            sizePx,
            centerMark: centerMark ?? undefined,
        });
        res.setHeader('Content-Type', 'image/png');
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(downloadParam),
            buildQrDownloadFilename('page', {
                businessSlug: business.slug,
                accountSlug: account.slug,
                invoiceSlug: invoice.slug,
            })
        );
        res.send(png);
    }

    @SkipOnboarding()
    @Get(':invoiceSlug/qr/nbu.png')
    @Header('Cache-Control', 'no-store')
    async getNbuQr(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Param('invoiceSlug') invoiceSlug: string,
        @Query('host') hostParam: string | undefined,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const host = resolveNbuHost(hostParam);
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const { business, account, invoice } = await this.lookupOrThrow(
            slug,
            accountSlug,
            invoiceSlug
        );
        if (isInvoiceExpired(invoice.validUntil)) {
            throw new GoneException({
                code: RESPONSE_CODE.INVOICE_EXPIRED,
                message: 'Invoice expired',
            });
        }
        const input = buildPayloadInputFromInvoice(business, account, invoice);
        // Sprint 21 — кастомна верхня смуга активного бренду (null → Finly).
        const bandMark = await this.brandMarkCache.getActiveBandMark(business);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
            sizePx,
            topBandMark: bandMark ?? undefined,
        });
        res.setHeader('Content-Type', 'image/png');
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(downloadParam),
            buildQrDownloadFilename(
                host === NBU_HOST_PRIMARY
                    ? 'payment-primary'
                    : 'payment-legacy',
                {
                    businessSlug: business.slug,
                    accountSlug: account.slug,
                    invoiceSlug: invoice.slug,
                }
            )
        );
        res.send(png);
    }

    private async lookupOrThrow(
        slug: string,
        accountSlug: string,
        invoiceSlug: string
    ): Promise<{
        business: BusinessDocument;
        account: AccountDocument;
        invoice: InvoiceDocument;
    }> {
        // Sprint 14/15 — historical-slug fallback на всіх трьох рівнях. SC
        // порівнює кожен сегмент з canonical (`view.business.slug` /
        // `view.account.slug` / `view.slug`) і робить один `permanentRedirect()`
        // на повний canonical URL. Account/invoice slug тепер редаговувані
        // (Sprint 15), тому теж мають history-fallback. Композиція: rename
        // рахунку лагодить і вкладені invoice-посилання (сегмент рахунку
        // резолвиться history-fallback-ом перед пошуком інвойсу).
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
        const invoice = await this.invoicesService.getBySlugOrHistorical(
            account._id,
            invoiceSlug
        );
        if (!invoice) {
            throw new NotFoundException({
                code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                message: 'Invoice not found',
            });
        }
        return { business, account, invoice };
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
