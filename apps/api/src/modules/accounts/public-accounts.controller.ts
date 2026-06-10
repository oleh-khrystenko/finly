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
    buildQrDownloadFilename,
    NBU_HOST_LEGACY,
    NBU_HOST_PRIMARY,
    PublicAccountViewSchema,
    RESPONSE_CODE,
    type AllowedNbuPayloadLinkHost003,
    type PublicAccountView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { PUBLIC_PAGE_CACHE_CONTROL } from '../../common/http/public-cache';
import { ENV } from '../../config/env';
import { BusinessesService } from '../businesses/businesses.service';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import {
    applyQrDownloadDisposition,
    isQrDownloadRequested,
    resolveQrSizePxFromQuery,
} from '../qr/qr-image-request';
import { QrService } from '../qr/qr.service';
import { AccountsService } from './accounts.service';
import { buildPayloadInputFromAccount } from './payload-mapper';
import type { AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — public endpoints для зони `pay.finly.com.ua/{businessSlug}/
 * {accountSlug}`. Той самий patern, що Sprint 3 `PublicBusinessesController`:
 *  - без guard-ів, без cookie / Authorization.
 *  - короткий CDN-cache `PUBLIC_PAGE_CACHE_CONTROL` (сторінка revocable через
 *    `accessBlockedAt`, тож без stale-while-revalidate — гасіння у межах TTL).
 *  - whitelist `PublicAccountViewSchema` strip-ить leak-кандидати.
 *  - реквізити leak-vector лише через `nbuLinks` Base64URL payload.
 *
 * **Throttle policy** — той самий `'public-payment'` 600/min/IP як Sprint 3
 * business-public.
 */
@SkipThrottle({ default: true })
@Throttle({ 'public-payment': { limit: 600, ttl: 60000 } })
@Controller('businesses/public/:slug/account')
export class PublicAccountsController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly accountsService: AccountsService,
        private readonly qrService: QrService
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
        const payloadInput = buildPayloadInputFromAccount(business, account);
        const view = PublicAccountViewSchema.parse({
            slug: account.slug,
            name: account.name,
            bankCode: account.bankCode,
            ibanMask: `•${account.iban.slice(-4)}`,
            business: {
                type: business.type,
                name: business.name,
                slug: business.slug,
                seoIndexEnabled: business.seoIndexEnabled,
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
        const png = await this.qrService.renderForUrl(url, { sizePx });
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
        const input = buildPayloadInputFromAccount(business, account);
        const png = await this.qrService.renderForNbuPayload(input, '003', {
            host,
            sizePx,
        });
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(downloadParam),
            buildQrDownloadFilename(
                host === NBU_HOST_PRIMARY
                    ? 'payment-primary'
                    : 'payment-legacy',
                { businessSlug: business.slug, accountSlug: account.slug }
            )
        );
        res.send(png);
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
