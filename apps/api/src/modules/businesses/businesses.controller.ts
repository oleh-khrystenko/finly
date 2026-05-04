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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { InvoicesService } from '../invoices/invoices.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { BusinessAccessGuard, CurrentBusiness } from './business-access.guard';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
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
    ): Promise<{ data: BusinessDocument[] }> {
        const items = await this.businessesService.getOwnedAndManaged(
            user._id.toString(),
            user.worksAsBookkeeper
        );
        return { data: items };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: UserDocument,
        @Body() dto: CreateBusinessDto
    ): Promise<{ data: BusinessDocument }> {
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
    ): Promise<{ data: BusinessDocument & { invoicesCount: number } }> {
        // Sprint 4 §4.2 — додаємо `invoicesCount` до response, щоб cabinet UI
        // показував counter активних інвойсів (Sprint 4 §4.4 secondary CTA на
        // `/business`-листі) і delete-confirm warning (Sprint 4 §SP-5: ФОП
        // знає цифру **до** натискання "Видалити", не після). Cheap aggregate
        // через `(businessId, createdAt)`-index prefix-match.
        const invoicesCount = await this.invoicesService.countByBusinessId(
            business._id
        );
        // Spread `.toJSON()` зберігає всі Mongoose-virtual fields і
        // serialization, додаючи поле зверху без порушення Mongoose-shape.
        return {
            data: {
                ...business.toJSON(),
                invoicesCount,
            } as BusinessDocument & {
                invoicesCount: number;
            },
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
