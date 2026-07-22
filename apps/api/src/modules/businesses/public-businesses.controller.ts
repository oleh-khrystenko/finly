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
    PublicCatalogSchema,
    RESPONSE_CODE,
    type PublicBusinessView,
    type PublicCatalogView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { PUBLIC_PAGE_CACHE_CONTROL } from '../../common/http/public-cache';
import { skipThrottlersExcept } from '../../common/http/throttle-policy';
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
import { Business, type BusinessDocument } from './schemas/business.schema';
import { BrandMarkCacheService } from './brand-mark-cache.service';
import { buildPublicBrandView } from './brand-public-view';
import {
    isPublicAccountListed,
    resolvePublicIndexEnabled,
} from './public-index-policy';
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
 * SWR — сторінка revocable: видалення бізнесу і slug-rent мусять гаснути в
 * межах TTL). Реквізити
 * leak-vector лише через `nbuLinks` на per-account-page (Base64URL у платіжній
 * команді банку), не у JSON.
 *
 * **Throttle policy** — `'public-payment'` 600/min/IP. Скіп рахується від повного
 * реєстру бакетів (`skipThrottlersExcept`), а не `{ default: true }`: guard
 * проганяє кожен named-бакет на кожному роуті, тож нижчі (`qr-preview` 10/хв)
 * тіньовили б оголошені 600 до ефективних 10. Гостро саме тут, бо сторінки тягне
 * Next server-side одним IP контейнера, а Sprint 29 завів на pay-хост краулерів.
 */
@SkipThrottle(skipThrottlersExcept('public-payment'))
@Throttle({ 'public-payment': { limit: 600, ttl: 60000 } })
@Controller('businesses/public')
export class PublicBusinessesController {
    constructor(
        private readonly businessesService: BusinessesService,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        private readonly qrService: QrService,
        private readonly brandMarkCache: BrandMarkCacheService
    ) {}

    /**
     * Sitemap для opt-in public payment pages. Інвойси не включаємо: вони
     * hardcoded `noindex`, одноразові й можуть містити чутливий purpose.
     *
     * Root business URL включається тільки коли він реально рендериться
     * (0 або 2+ рахунки). Для бізнесу з рівно одним account canonical surface
     * фактично per-account URL, бо root дає умовний 307 redirect.
     */
    @SkipOnboarding()
    @Get('sitemap.xml')
    @Header('Content-Type', 'application/xml; charset=utf-8')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getSitemap(): Promise<string> {
        const businesses = await this.businessModel
            .find({
                seoIndexEnabled: true,
                deletedAt: null,
            })
            .select(
                '_id slug updatedAt seoIndexEnabled isSystem catalogVisible'
            )
            .sort({ createdAt: -1 })
            .lean<
                Array<{
                    _id: unknown;
                    slug: string;
                    updatedAt?: Date;
                    seoIndexEnabled: boolean;
                    isSystem?: boolean;
                    catalogVisible?: boolean;
                }>
            >()
            .exec();
        const businessIds = businesses.map((business) => business._id);
        const accounts = await this.accountModel
            .find({
                businessId: { $in: businessIds },
                deletedAt: null,
            })
            .select('businessId slug updatedAt catalogVisible')
            .sort({ createdAt: 1 })
            .lean<
                Array<{
                    businessId: unknown;
                    slug: string;
                    updatedAt?: Date;
                    catalogVisible?: boolean;
                }>
            >()
            .exec();
        const accountsByBusiness = new Map<string, typeof accounts>();
        for (const account of accounts) {
            const key = String(account.businessId);
            const bucket = accountsByBusiness.get(key) ?? [];
            bucket.push(account);
            accountsByBusiness.set(key, bucket);
        }

        const baseUrl = ENV.PAY_PUBLIC_URL.replace(/\/$/, '');
        // Sprint 29 — головна pay-хоста (каталог) стала індексованою, але лише
        // коли каталог непорожній: на порожньому сторінка рендерить пояснювач і
        // сама віддає `noindex` (`app/host-pay/page.tsx`). Безумовний запис тут
        // означав би URL у sitemap з noindex на сторінці — помилку в Search
        // Console на першому ж індексованому URL хоста. Умова мусить збігатися з
        // тією, що керує метаданими сторінки.
        const catalog = await this.businessesService.getPublicCatalog();
        const urls: Array<{ loc: string; lastmod?: Date }> =
            catalog.sections.length > 0 ? [{ loc: `${baseUrl}/` }] : [];
        for (const business of businesses) {
            const businessAccounts =
                accountsByBusiness.get(String(business._id)) ?? [];
            // Sprint 29 — приховані рівні системного отримувача випадають із
            // sitemap за тим самим предикатом, що керує `robots` на сторінці
            // (`resolvePublicIndexEnabled`). Розбіжність між sitemap і сторінкою
            // означала б URL із `noindex`, поданий Google, тобто помилку в Search
            // Console. Кількість рахунків рахуємо по ПОВНОМУ списку: root віддає
            // умовний 307 на єдиний рахунок незалежно від видимості в каталозі.
            if (
                businessAccounts.length !== 1 &&
                resolvePublicIndexEnabled(business)
            ) {
                urls.push({
                    loc: `${baseUrl}/${business.slug}`,
                    lastmod: business.updatedAt,
                });
            }
            for (const account of businessAccounts) {
                if (!resolvePublicIndexEnabled(business, account)) continue;
                urls.push({
                    loc: `${baseUrl}/${business.slug}/${account.slug}`,
                    lastmod: account.updatedAt ?? business.updatedAt,
                });
            }
        }

        return buildSitemapXml(urls);
    }

    /**
     * Sprint 29 — публічний каталог отримувачів (головна pay-хоста). Оголошено
     * ДО `:slug`, інакше `catalog` перехопився б як business-slug.
     */
    @SkipOnboarding()
    @Get('catalog')
    @Header('Cache-Control', PUBLIC_PAGE_CACHE_CONTROL)
    async getCatalog(): Promise<{ data: PublicCatalogView }> {
        const catalog = await this.businessesService.getPublicCatalog();
        return { data: PublicCatalogSchema.parse(catalog) };
    }

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
        const allAccounts = await this.accountModel
            .find({ businessId: business._id })
            .sort({ createdAt: 1 })
            .exec();
        // Приховані реквізити системного отримувача не потрапляють у список
        // (`isPublicAccountListed`): картка каталогу веде саме сюди, і застарілий
        // державний IBAN інакше лишався б поруч з новим. Для звичайних
        // отримувачів список незмінний — прапорець керує лише каталогом.
        const accounts = allAccounts.filter((a) =>
            isPublicAccountListed(business, a)
        );
        const view = PublicBusinessSchema.parse({
            type: business.type,
            name: business.name,
            slug: business.slug,
            seoIndexEnabled: resolvePublicIndexEnabled(business),
            ...buildPublicBrandView(business),
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

export function buildSitemapXml(
    urls: Array<{ loc: string; lastmod?: Date }>
): string {
    const entries = urls
        .map(({ loc, lastmod }) => {
            const lastmodTag = lastmod
                ? `\n    <lastmod>${lastmod.toISOString()}</lastmod>`
                : '';
            return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}\n  </url>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
