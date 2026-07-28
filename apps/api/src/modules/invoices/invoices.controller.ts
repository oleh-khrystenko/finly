import {
    Body,
    Controller,
    DefaultValuePipe,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import {
    InvoiceSlugCandidateSchema,
    type InvoiceSlugCandidate,
    type SlugAvailabilityResponse,
    type SlugReservationView,
} from '@finly/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRateLimit } from '../../common/decorators/user-rate-limit.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { UserRateLimitGuard } from '../../common/guards/user-rate-limit.guard';
import {
    skipThrottlersExcept,
    USER_RATE_LIMITS,
} from '../../common/http/throttle-policy';
import {
    AccountAccessGuard,
    CurrentAccount,
} from '../accounts/account-access.guard';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import {
    BusinessAccessGuard,
    CurrentBusiness,
} from '../businesses/business-access.guard';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { toSlugReservationView } from '../slug-reservation/slug-reservation.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ResetInvoiceSlugDto } from './dto/reset-invoice-slug.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CurrentInvoice, InvoiceAccessGuard } from './invoice-access.guard';
import { InvoicesService, type PaginatedInvoices } from './invoices.service';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.2 + Sprint 9 §9.1 — cabinet endpoints для invoices під префіксом
 * `/businesses/me/:slug/accounts/:accountSlug/invoices`.
 *
 * **Guard-chain** (Sprint 9 рефакторинг):
 *  - `JwtActiveGuard` (auth + soft-delete check) + `BusinessAccessGuard`
 *    (resolve `:slug`) + `AccountAccessGuard` (resolve `:accountSlug`) — на класі.
 *  - `InvoiceAccessGuard` на route-методах з `:invoiceSlug` (read/update/delete).
 */
@Controller('businesses/me/:slug/accounts/:accountSlug/invoices')
@UseGuards(JwtActiveGuard, BusinessAccessGuard, AccountAccessGuard)
// Кабінет за логіном: throttle вимкнено повністю (див. BusinessesController).
@SkipThrottle(skipThrottlersExcept())
export class InvoicesController {
    constructor(private readonly invoicesService: InvoicesService) {}

    @Get()
    async list(
        @CurrentAccount() account: AccountDocument,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
    ): Promise<{ data: PaginatedInvoices }> {
        const data = await this.invoicesService.getByAccountId(account._id, {
            page: Math.max(page, 1),
            limit: Math.min(Math.max(limit, 1), 50),
        });
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @Body() dto: CreateInvoiceDto
    ): Promise<{ data: InvoiceDocument }> {
        const invoice = await this.invoicesService.create(
            business,
            account,
            dto
        );
        return { data: invoice };
    }

    @Get(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    getOne(@CurrentInvoice() invoice: InvoiceDocument): {
        data: InvoiceDocument;
    } {
        return { data: invoice };
    }

    @Patch(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    async update(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Body() dto: UpdateInvoiceDto
    ): Promise<{ data: InvoiceDocument }> {
        const updated = await this.invoicesService.update(
            business,
            account,
            invoice,
            dto,
            user._id.toString()
        );
        return { data: updated };
    }

    @Post(':invoiceSlug/reset-slug')
    @UseGuards(InvoiceAccessGuard)
    @HttpCode(HttpStatus.OK)
    async resetSlug(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Body() dto: ResetInvoiceSlugDto
    ): Promise<{ data: InvoiceDocument }> {
        const updated = await this.invoicesService.resetSlug(
            business,
            account,
            invoice,
            user._id.toString(),
            dto.mode
        );
        return { data: updated };
    }

    /**
     * Sprint 20 — live-доступність бажаного імені документа до оплати. Усі
     * рівні, окремий rate-limit — per-user (див. `businesses.controller`).
     */
    @Get(':invoiceSlug/slug-availability')
    @UserRateLimit(USER_RATE_LIMITS.slugAvailability)
    @UseGuards(UserRateLimitGuard, InvoiceAccessGuard)
    async checkSlugAvailability(
        @CurrentUser() user: UserDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Query(new ZodValidationPipe(InvoiceSlugCandidateSchema))
        query: InvoiceSlugCandidate
    ): Promise<{ data: SlugAvailabilityResponse }> {
        const status = await this.invoicesService.checkSlugAvailability(
            invoice,
            query.slug,
            user._id.toString()
        );
        return { data: { slug: query.slug, status } };
    }

    /**
     * Sprint 20 — холд бажаного вільного імені документа (free-flow на Save).
     */
    @Post(':invoiceSlug/slug-reservation')
    @UseGuards(InvoiceAccessGuard)
    @HttpCode(HttpStatus.CREATED)
    async reserveSlug(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Body(new ZodValidationPipe(InvoiceSlugCandidateSchema))
        dto: InvoiceSlugCandidate
    ): Promise<{ data: SlugReservationView }> {
        const reservation = await this.invoicesService.reserveSlug(
            business,
            account,
            invoice,
            dto.slug,
            user._id.toString()
        );
        return { data: toSlugReservationView(reservation) };
    }

    @Delete(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentInvoice() invoice: InvoiceDocument
    ): Promise<{ data: null }> {
        await this.invoicesService.delete(invoice);
        return { data: null };
    }
}
