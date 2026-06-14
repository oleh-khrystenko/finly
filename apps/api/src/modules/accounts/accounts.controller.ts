import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import {
    AccountSlugCandidateSchema,
    type AccessLevel,
    type AccountSlugCandidate,
    type AccountWithCounts,
    type SlugAvailabilityResponse,
    type SlugReservationView,
} from '@finly/types';

import { CurrentAccessLevel } from '../../common/decorators/current-access-level.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import {
    BusinessAccessGuard,
    CurrentBusiness,
} from '../businesses/business-access.guard';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { toSlugReservationView } from '../slug-reservation/slug-reservation.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { AccountAccessGuard, CurrentAccount } from './account-access.guard';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import type { AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — cabinet endpoints для accounts під префіксом
 * `/businesses/me/:slug/accounts`.
 *
 * **Guard-chain:**
 *  - `JwtActiveGuard` (auth + soft-delete check) + `BusinessAccessGuard`
 *    (resolve `:slug`) — на класі.
 *  - `AccountAccessGuard` на роутах з `:accountSlug` (read/update/delete).
 */
@Controller('businesses/me/:slug/accounts')
@UseGuards(JwtActiveGuard, BusinessAccessGuard)
export class AccountsController {
    constructor(private readonly accountsService: AccountsService) {}

    @Get()
    async list(
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: AccountWithCounts[] }> {
        const items = await this.accountsService.listForBusinessWithCounts(
            business._id
        );
        return { data: items };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentBusiness() business: BusinessDocument,
        @Body() dto: CreateAccountDto
    ): Promise<{ data: AccountDocument }> {
        const account = await this.accountsService.create(business, dto);
        return { data: account };
    }

    @Get(':accountSlug')
    @UseGuards(AccountAccessGuard)
    async getOne(
        @CurrentAccount() account: AccountDocument
    ): Promise<{ data: AccountWithCounts }> {
        const invoicesCount = await this.accountsService.countInvoices(
            account._id
        );
        const plain = account.toJSON() as unknown as Omit<
            AccountWithCounts,
            'invoicesCount'
        >;
        return { data: { ...plain, invoicesCount } };
    }

    @Patch(':accountSlug')
    @UseGuards(AccountAccessGuard)
    async update(
        @CurrentUser() user: UserDocument,
        @CurrentAccount() account: AccountDocument,
        @CurrentAccessLevel() actorLevel: AccessLevel,
        @Body() dto: UpdateAccountDto
    ): Promise<{ data: AccountDocument }> {
        const updated = await this.accountsService.update(
            account,
            dto,
            actorLevel,
            user._id.toString()
        );
        return { data: updated };
    }

    @Post(':accountSlug/reset-slug')
    @UseGuards(AccountAccessGuard)
    @HttpCode(HttpStatus.OK)
    async resetSlug(
        @CurrentUser() user: UserDocument,
        @CurrentAccount() account: AccountDocument
    ): Promise<{ data: AccountDocument }> {
        const updated = await this.accountsService.resetSlug(
            account,
            user._id.toString()
        );
        return { data: updated };
    }

    /**
     * Sprint 20 — live-доступність бажаного імені рахунку до оплати. Усі рівні,
     * окремий rate-limit.
     */
    @Get(':accountSlug/slug-availability')
    @UseGuards(AccountAccessGuard)
    // Лише власний бакет `slug-availability` (30/min) — skip інших named-
    // throttler-ів, що інакше тіньовили б ліміт (див. businesses.controller).
    @Throttle({ 'slug-availability': { limit: 30, ttl: 60_000 } })
    @SkipThrottle({
        default: true,
        'public-payment': true,
        'qr-preview': true,
        'help-chat': true,
    })
    async checkSlugAvailability(
        @CurrentUser() user: UserDocument,
        @CurrentAccount() account: AccountDocument,
        @Query(new ZodValidationPipe(AccountSlugCandidateSchema))
        query: AccountSlugCandidate
    ): Promise<{ data: SlugAvailabilityResponse }> {
        const status = await this.accountsService.checkSlugAvailability(
            account,
            query.slug,
            user._id.toString()
        );
        return { data: { slug: query.slug, status } };
    }

    /**
     * Sprint 20 — холд бажаного вільного імені рахунку (free-flow на Save).
     */
    @Post(':accountSlug/slug-reservation')
    @UseGuards(AccountAccessGuard)
    @HttpCode(HttpStatus.CREATED)
    async reserveSlug(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @Body(new ZodValidationPipe(AccountSlugCandidateSchema))
        dto: AccountSlugCandidate
    ): Promise<{ data: SlugReservationView }> {
        const reservation = await this.accountsService.reserveSlug(
            business,
            account,
            dto.slug,
            user._id.toString()
        );
        return { data: toSlugReservationView(reservation) };
    }

    @Delete(':accountSlug')
    @UseGuards(AccountAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentAccount() account: AccountDocument
    ): Promise<{ data: { affectedInvoices: number } }> {
        const result = await this.accountsService.delete(account);
        return { data: result };
    }
}
