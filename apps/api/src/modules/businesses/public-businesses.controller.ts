import {
    Controller,
    Get,
    Header,
    NotFoundException,
    Param,
    Query,
    Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
    buildQrDownloadFilename,
    PublicBusinessSchema,
    RESPONSE_CODE,
    type PublicBusinessView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { PUBLIC_PAGE_CACHE_CONTROL } from '../../common/http/public-cache';
import { ENV } from '../../config/env';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import {
    applyQrDownloadDisposition,
    isQrDownloadRequested,
    resolveQrSizePxFromQuery,
} from '../qr/qr-image-request';
import { QrService } from '../qr/qr.service';
import type { BusinessDocument } from './schemas/business.schema';
import { BrandMarkCacheService } from './brand-mark-cache.service';
import { BusinessesService } from './businesses.service';

/**
 * Sprint 3 §3.3 + Sprint 9 §SP-4 — public endpoints для зони
 * `pay.finly.com.ua`.
 *
 * `getPublic` повертає `accounts: PublicAccountListItem[]` (root-list-view);
 * Frontend Server Component робить switch на `accounts.length`. QR-endpoints
 * видалено — переїхали на `PublicAccountsController`.
 *
 * **Accounts через direct `accountModel.find`** (Sprint 9 review fix): без
 * inject `AccountsService` — щоб уникнути `BusinessesModule ↔ AccountsModule`
 * JS-cycle. Mongoose-`forFeature(Account)` уже зареєстровано у власному
 * BusinessesModule (для cascade-delete-business). Sort `{ createdAt: 1 }` —
 * customer-perspective "перший-створений = основний-рахунок зверху".
 *
 * **Whitelist 5 полів** + cache `PUBLIC_PAGE_CACHE_CONTROL` (короткий TTL без
 * SWR — сторінка revocable через `accessBlockedAt`). Реквізити
 * leak-vector лише через `nbuLinks` на per-account-page (Base64URL у платіжній
 * команді банку), не у JSON.
 *
 * **Throttle policy** — `'public-payment'` 600/min/IP.
 */
@SkipThrottle({ default: true })
@Throttle({ 'public-payment': { limit: 600, ttl: 60000 } })
@Controller('businesses/public')
export class PublicBusinessesController {
    constructor(
        private readonly businessesService: BusinessesService,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        private readonly qrService: QrService,
        private readonly brandMarkCache: BrandMarkCacheService
    ) {}

    @SkipOnboarding()
    @Get(':slug')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getPublic(
        @Param('slug') slug: string
    ): Promise<{ data: PublicBusinessView }> {
        // Sprint 14 — `getBySlugOrHistorical` fallback-ить у BusinessSlugHistory
        // після miss у Business; повертає current Business. SC
        // `host-pay/[slug]/page.tsx` порівнює `params.slug !== view.slug` і
        // робить `permanentRedirect()` на canonical URL — тут окремої redirect-
        // логіки писати не треба, reuse-имо існуючий canonical-case
        // redirect-механізм.
        const business = await this.getBusinessOrThrow(slug);
        const accounts = await this.accountModel
            .find({ businessId: business._id })
            .sort({ createdAt: 1 })
            .exec();
        const view = PublicBusinessSchema.parse({
            type: business.type,
            name: business.name,
            slug: business.slug,
            seoIndexEnabled: business.seoIndexEnabled,
            accounts: accounts.map((a) => ({
                slug: a.slug,
                name: a.name,
                bankCode: a.bankCode,
                ibanMask: `•${a.iban.slice(-4)}`,
            })),
        });
        return { data: view };
    }

    /**
     * Sprint 14 — QR тип-2 на публічну сторінку-вітрину бізнесу
     * (`pay.finly.com.ua/{businessSlug}`). Симетричний до account/invoice
     * `qr/business.png`. Тип-1 (НБУ-payload) на рівні бізнесу неможливий —
     * IBAN живе на рахунку, не на бізнесі.
     *
     * `?size=screen|print` (дефолт екранний), `?download=1` — attachment для
     * друку. Кеш per-розмір автоматичний (URL включає query).
     */
    @SkipOnboarding()
    @Get(':slug/qr/business.png')
    @Header('Content-Type', 'image/png')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getBusinessQr(
        @Param('slug') slug: string,
        @Query('size') sizeParam: string | undefined,
        @Query('download') downloadParam: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        const sizePx = resolveQrSizePxFromQuery(sizeParam);
        const business = await this.getBusinessOrThrow(slug);
        const url = `${ENV.PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}`;
        // Sprint 21 — кастомний центр активного бренду (null → дефолтний Finly).
        const centerMark =
            await this.brandMarkCache.getActiveCenterMark(business);
        const png = await this.qrService.renderForUrl(url, {
            sizePx,
            centerMark: centerMark ?? undefined,
        });
        applyQrDownloadDisposition(
            res,
            isQrDownloadRequested(downloadParam),
            buildQrDownloadFilename('page', { businessSlug: business.slug })
        );
        res.send(png);
    }

    private async getBusinessOrThrow(slug: string): Promise<BusinessDocument> {
        const business =
            await this.businessesService.getBySlugOrHistorical(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }
        return business;
    }
}
