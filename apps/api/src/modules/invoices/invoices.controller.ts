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
 * Sprint 4 §4.2 — cabinet endpoints для invoices під префіксом
 * `/businesses/me/:slug/invoices`.
 *
 * **Route-param бізнесу — `:slug`, не `:businessSlug`** (consistency з Sprint 3
 * `BusinessAccessGuard`, що читає `request.params.slug`). Invoice slug —
 * `:invoiceSlug` (різне ім'я, щоб NestJS не плутав і `InvoiceAccessGuard` мав
 * окремий route-param для read).
 *
 * **Guard-chain**:
 *  - `JwtActiveGuard` (auth + soft-delete check) — на класі.
 *  - `BusinessAccessGuard` — на класі (resolve `:slug` → attach `request.business`).
 *  - `InvoiceAccessGuard` — на route-методах з `:invoiceSlug` (read/update/delete).
 *
 * Class-level `@UseGuards` гарантує, що всі route-методи (включно з list/create)
 * проходять через business-access — без цього зловмисник міг би list-нути
 * invoices чужого business.
 */
@Controller('businesses/me/:slug/invoices')
@UseGuards(JwtActiveGuard, BusinessAccessGuard)
export class InvoicesController {
    constructor(private readonly invoicesService: InvoicesService) {}

    @Get()
    async list(
        @CurrentBusiness() business: BusinessDocument,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
    ): Promise<{ data: PaginatedInvoices }> {
        const data = await this.invoicesService.getByBusinessId(business._id, {
            page: Math.max(page, 1),
            limit: Math.min(Math.max(limit, 1), 50),
        });
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentBusiness() business: BusinessDocument,
        @Body() dto: CreateInvoiceDto
    ): Promise<{ data: InvoiceDocument }> {
        const invoice = await this.invoicesService.create(business, dto);
        return { data: invoice };
    }

    @Get(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    getOne(@CurrentInvoice() invoice: InvoiceDocument): {
        data: InvoiceDocument;
    } {
        // Lookup уже зробив guard; controller просто обгортає у envelope.
        return { data: invoice };
    }

    @Patch(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    async update(
        @CurrentBusiness() business: BusinessDocument,
        @CurrentInvoice() invoice: InvoiceDocument,
        @Body() dto: UpdateInvoiceDto
    ): Promise<{ data: InvoiceDocument }> {
        const updated = await this.invoicesService.update(
            business._id,
            invoice.slug,
            dto
        );
        return { data: updated };
    }

    @Delete(':invoiceSlug')
    @UseGuards(InvoiceAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentBusiness() business: BusinessDocument,
        @CurrentInvoice() invoice: InvoiceDocument
    ): Promise<{ data: null }> {
        await this.invoicesService.delete(business._id, invoice.slug);
        return { data: null };
    }
}
