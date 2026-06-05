import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import type { AccountWithCounts } from '@finly/types';

import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import {
    BusinessAccessGuard,
    CurrentBusiness,
} from '../businesses/business-access.guard';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
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
        @CurrentAccount() account: AccountDocument,
        @Body() dto: UpdateAccountDto
    ): Promise<{ data: AccountDocument }> {
        const updated = await this.accountsService.update(account, dto);
        return { data: updated };
    }

    @Post(':accountSlug/reset-slug')
    @UseGuards(AccountAccessGuard)
    @HttpCode(HttpStatus.OK)
    async resetSlug(
        @CurrentAccount() account: AccountDocument
    ): Promise<{ data: AccountDocument }> {
        const updated = await this.accountsService.resetSlug(account);
        return { data: updated };
    }

    @Delete(':accountSlug')
    @UseGuards(AccountAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentAccount() account: AccountDocument
    ): Promise<{ data: null }> {
        await this.accountsService.delete(account);
        return { data: null };
    }
}
