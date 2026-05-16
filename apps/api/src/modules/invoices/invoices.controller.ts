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

import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
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
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccount() account: AccountDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Body() dto: UpdateInvoiceDto
    ): Promise<{ data: InvoiceDocument }> {
        const updated = await this.invoicesService.update(
            business,
            account,
            invoice.slug,
            dto
        );
        return { data: updated };
    }

    @Delete(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentAccount() account: AccountDocument,
        @CurrentInvoice() invoice: InvoiceDocument
    ): Promise<{ data: null }> {
        await this.invoicesService.delete(account._id, invoice.slug);
        return { data: null };
    }
}
