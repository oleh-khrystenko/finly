import {
    Controller,
    Get,
    Header,
    NotFoundException,
    Param,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
    PublicBusinessSchema,
    RESPONSE_CODE,
    type PublicBusinessView,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
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
 * **Whitelist 6 полів** + cache `public, max-age=3600, SWR=86400`. Реквізити
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
        private readonly accountModel: Model<AccountDocument>
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
        const accounts = await this.accountModel
            .find({ businessId: business._id })
            .sort({ createdAt: 1 })
            .exec();
        const view = PublicBusinessSchema.parse({
            type: business.type,
            name: business.name,
            slug: business.slug,
            acceptedBanks: business.acceptedBanks,
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
}
