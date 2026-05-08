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
import { ZodValidationPipe } from 'nestjs-zod';
import {
    CreateBusinessSchema,
    type BusinessWithInvoicesCount,
    type CreateBusinessRequest,
} from '@finly/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { InvoicesService } from '../invoices/invoices.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { BusinessAccessGuard, CurrentBusiness } from './business-access.guard';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessDto } from './dto/update-business.dto';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 3 §3.2 — cabinet endpoints для бізнесів. Префікс `/businesses/me`.
 *
 * Усі маршрути під `JwtActiveGuard`. Маршрути з `:slug` додатково під
 * `BusinessAccessGuard`, що (1) лукапить бізнес case-insensitively через
 * `slugLower`, (2) перевіряє ownership/managers, (3) attach-ить resolved
 * document до `request.business` для `@CurrentBusiness()`.
 *
 * **Slug — primary route-param** (не `:id`). Frontend знає бізнес по slug-у;
 * resolve через `slugLower` unique-index — O(1). Окремий `/resolve?slug=...`
 * як проксі для `:id` — зайвий round-trip і додаткова поверхня помилок.
 *
 * **QR endpoints — НЕ тут.** Cabinet рендерить QR через ті самі public-URL
 * (`<img src='/api/businesses/public/{slug}/qr/...'>`); реальні endpoints
 * живуть у `PublicBusinessesController` (§3.3) — рішення про cache-safety
 * на shared CDN детально пояснене там. Cabinet просто реюзає public URL без
 * auth-у; жодних cabinet-only QR endpoints не існує навмисно.
 */
@Controller('businesses/me')
@UseGuards(JwtActiveGuard)
export class BusinessesController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly invoicesService: InvoicesService
    ) {}

    @Get()
    async list(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: BusinessWithInvoicesCount[] }> {
        // Sprint 4 §4.4 — single-aggregation pipeline через
        // `getOwnedAndManagedWithInvoicesCount` (`$lookup` + nested `$count`).
        // Один Mongo round-trip незалежно від кількості бізнесів — масштабується
        // до бухгалтерів з 500+ клієнтами без linear-degradation.
        const items =
            await this.businessesService.getOwnedAndManagedWithInvoicesCount(
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
        //
        // Глобальний `ZodValidationPipe` (зареєстрований у `main.ts`)
        // пропускає payload (metatype = primitive `Object` без `isZodDto`),
        // param-level pipe виконує `validate(value, CreateBusinessSchema)` —
        // повна discriminated-union-валідація. `dto` тип-narrow-ається через
        // `dto.type` discriminator без cast-ів.
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
    ): Promise<{ data: BusinessWithInvoicesCount }> {
        // Sprint 4 §4.2 — додаємо `invoicesCount` до response, щоб cabinet UI
        // показував counter активних інвойсів (Sprint 4 §4.4 secondary CTA на
        // `/business`-листі) і delete-confirm warning (Sprint 4 §SP-5: ФОП
        // знає цифру **до** натискання "Видалити", не після). Cheap aggregate
        // через `(businessId, createdAt)`-index prefix-match.
        const invoicesCount = await this.invoicesService.countByBusinessId(
            business._id
        );
        // `business.toJSON()` тригерить `applyJsonTransform` (`_id → id`,
        // strip `__v`), повертає plain-object матчить `Business`-entity-shape.
        // Type-cast через `as` — bridge від generic Mongoose `toJSON()`
        // return-type (`Record<string, unknown>`) до strongly-typed contract.
        const plain = business.toJSON() as unknown as Omit<
            BusinessWithInvoicesCount,
            'invoicesCount'
        >;
        return {
            data: { ...plain, invoicesCount },
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

    @Delete(':slug')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: { affectedInvoices: number } }> {
        // Sprint 4 §SP-5 — повертаємо counter cascade-видалених інвойсів,
        // щоб frontend показав warning у success-toast ("Видалено бізнес і
        // {N} рахунків"). Atomic-or-nothing через `withTransaction` —
        // деталі у `BusinessesService.delete`.
        const result = await this.businessesService.delete(business);
        return { data: result };
    }
}
