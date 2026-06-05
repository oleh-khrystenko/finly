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
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ZodValidationPipe } from 'nestjs-zod';
import {
    CreateBusinessSchema,
    type BusinessWithCounts,
    type CreateBusinessRequest,
} from '@finly/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import {
    Invoice,
    type InvoiceDocument,
} from '../invoices/schemas/invoice.schema';
import type { UserDocument } from '../users/schemas/user.schema';
import { BusinessAccessGuard, CurrentBusiness } from './business-access.guard';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessDto } from './dto/update-business.dto';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 3 §3.2 + Sprint 9 §9.1 — cabinet endpoints для бізнесів. Префікс
 * `/businesses/me`.
 *
 * Усі маршрути під `JwtActiveGuard`. Маршрути з `:slug` додатково під
 * `BusinessAccessGuard`, що (1) лукапить бізнес case-insensitively через
 * `slugLower`, (2) перевіряє ownership/managers, (3) attach-ить resolved
 * document до `request.business` для `@CurrentBusiness()`.
 *
 * **Counter-aggregation через direct model query** (Sprint 9 review fix):
 * cabinet `getBySlug` потребує `accountsCount` + `invoicesCount` як cheap
 * counter aggregate. Sprint 4 Pattern був "повторна реєстрація `InvoicesService`
 * як provider у BusinessesModule" — це створювало duplicate DI-instance і
 * вимагало `forwardRef(() => AccountsModule)` для AccountsService, що
 * формувало JS-import-cycle (`businesses ↔ accounts ↔ invoices`). Sprint 9
 * розв'язує: BusinessesController inject-ить `accountModel` + `invoiceModel`
 * напряму через `@InjectModel` (моделі вже зареєстровані у `BusinessesModule.
 * forFeature` для cascade-delete-business §SP-5). One-way dependency tree:
 * `Users ← Businesses ← Accounts ← Invoices`, без cycle.
 */
@Controller('businesses/me')
@UseGuards(JwtActiveGuard)
export class BusinessesController {
    constructor(
        private readonly businessesService: BusinessesService,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>
    ) {}

    @Get()
    async list(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: BusinessWithCounts[] }> {
        // Sprint 9 §9.1 — single-aggregation pipeline з двома counters
        // (`accountsCount` + `invoicesCount`) per item. Один Mongo round-trip
        // незалежно від кількості бізнесів.
        const items = await this.businessesService.getOwnedAndManagedWithCounts(
            user._id.toString(),
            user.worksAsBookkeeper
        );
        return { data: items };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: UserDocument,
        @Body(new ZodValidationPipe(CreateBusinessSchema))
        dto: CreateBusinessRequest
    ): Promise<{ data: BusinessDocument }> {
        // Sprint 7 §SP-3 — `CreateBusinessSchema` — `z.discriminatedUnion`,
        // чий `parse()` повертає TS-union. `createZodDto` (nestjs-zod) не
        // підтримує union-output для class-extends (TS2509: Base constructor
        // return type ... is not an object type), тому використовуємо
        // **public param-level pipe** з конструктором `ZodValidationPipe
        // (schema)` — стандартний flow nestjs-zod без DTO-class wrapper-у.
        const business = await this.businessesService.create(
            user._id.toString(),
            dto,
            user.worksAsBookkeeper
        );
        return { data: business };
    }

    @Get(':slug')
    @UseGuards(BusinessAccessGuard)
    async getBySlug(
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: BusinessWithCounts }> {
        // Sprint 9 §9.1 — direct `countDocuments({businessId})` через моделі,
        // зареєстровані у власному `forFeature`. Без cross-module service-
        // injection — нема DI-cycle. Index `(businessId, createdAt)` (Sprint 9
        // schema) покриває обидва filter-и prefix-match-ом.
        const [accountsCount, invoicesCount] = await Promise.all([
            this.accountModel.countDocuments({ businessId: business._id }),
            this.invoiceModel.countDocuments({ businessId: business._id }),
        ]);
        const plain = business.toJSON() as unknown as Omit<
            BusinessWithCounts,
            'accountsCount' | 'invoicesCount'
        >;
        return {
            data: { ...plain, accountsCount, invoicesCount },
        };
    }

    @Patch(':slug')
    @UseGuards(BusinessAccessGuard)
    async update(
        @CurrentBusiness() business: BusinessDocument,
        @Body() dto: UpdateBusinessDto
    ): Promise<{ data: BusinessDocument }> {
        const updated = await this.businessesService.update(business.slug, dto);
        return { data: updated };
    }

    @Post(':slug/reset-slug')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.OK)
    async resetSlug(
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: BusinessDocument }> {
        const updated = await this.businessesService.resetSlug(business);
        return { data: updated };
    }

    @Delete(':slug')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(@CurrentBusiness() business: BusinessDocument): Promise<{
        data: { affectedAccounts: number; affectedInvoices: number };
    }> {
        // Sprint 9 §SP-5 — повертаємо обидва counters cascade-видалених
        // (accounts + invoices). Frontend toast: "Видалено бізнес, {N}
        // рахунків і {M} інвойсів".
        const result = await this.businessesService.delete(business);
        return { data: result };
    }
}
