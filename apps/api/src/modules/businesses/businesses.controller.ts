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
import { InjectModel } from '@nestjs/mongoose';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Model } from 'mongoose';
import { ZodValidationPipe } from 'nestjs-zod';
import {
    BusinessSlugCandidateSchema,
    CreateBusinessSchema,
    type AccessLevel,
    type BusinessSlugCandidate,
    type BusinessWithCounts,
    type CreateBusinessRequest,
    type SlugAvailabilityResponse,
    type SlugReservationView,
} from '@finly/types';

import { CurrentAccessLevel } from '../../common/decorators/current-access-level.decorator';
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
import { toSlugReservationView } from '../slug-reservation/slug-reservation.service';
import { BusinessAccessGuard, CurrentBusiness } from './business-access.guard';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { ReconciliationService } from './reconciliation.service';
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
        private readonly reconciliation: ReconciliationService,
        @InjectModel(Account.name)
        private readonly accountModel: Model<AccountDocument>,
        @InjectModel(Invoice.name)
        private readonly invoiceModel: Model<InvoiceDocument>
    ) {}

    @Get()
    async list(
        @CurrentUser() user: UserDocument,
        // Sprint 18 design — явний контекст списку. Frontend-перемикач
        // «Власні / Клієнтські» шле `?context=own|client`, щоб GET був
        // самодостатнім і не залежав від того, чи встиг паралельний
        // PATCH `worksAsBookkeeper` закомітитись (read-after-write race).
        // Відсутній/невалідний context → fallback на персистентний флаг
        // (initial-load, прямий API-виклик).
        @Query('context') context?: string
    ): Promise<{ data: BusinessWithCounts[] }> {
        const isBookkeeper =
            context === 'client'
                ? true
                : context === 'own'
                  ? false
                  : user.worksAsBookkeeper;
        // Sprint 9 §9.1 — single-aggregation pipeline з двома counters
        // (`accountsCount` + `invoicesCount`) per item. Один Mongo round-trip
        // незалежно від кількості бізнесів.
        const items = await this.businessesService.getOwnedAndManagedWithCounts(
            user._id.toString(),
            isBookkeeper
        );
        return { data: items };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: UserDocument,
        @CurrentAccessLevel() actorLevel: AccessLevel,
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
            user.worksAsBookkeeper,
            actorLevel
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
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @CurrentAccessLevel() actorLevel: AccessLevel,
        @Body() dto: UpdateBusinessDto
    ): Promise<{ data: BusinessDocument }> {
        const updated = await this.businessesService.update(
            business.slug,
            dto,
            actorLevel,
            user._id.toString()
        );
        return { data: updated };
    }

    @Post(':slug/reset-slug')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.OK)
    async resetSlug(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{ data: BusinessDocument }> {
        const updated = await this.businessesService.resetSlug(
            business,
            user._id.toString()
        );
        return { data: updated };
    }

    /**
     * Sprint 20 — live-перевірка доступності бажаного slug до будь-якої оплати
     * (гачок конверсії). Доступно всім рівням; окремий rate-limit проти
     * перебору. Без запису. Формат валідує `BusinessSlugCandidateSchema`.
     */
    @Get(':slug/slug-availability')
    @UseGuards(BusinessAccessGuard)
    // Лише власний бакет `slug-availability` (30/min) має керувати цим роутом.
    // Skip усіх інших named-throttler-ів: інакше нижчі `qr-preview` (10/min) і
    // `help-chat` (20/min), що теж діють на кожному роуті, тіньовили б 30 до
    // ефективних 10 і давали б хибний 429 на live-набір імені.
    @Throttle({ 'slug-availability': { limit: 30, ttl: 60_000 } })
    @SkipThrottle({
        default: true,
        'public-payment': true,
        'qr-preview': true,
        'help-chat': true,
    })
    async checkSlugAvailability(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @Query(new ZodValidationPipe(BusinessSlugCandidateSchema))
        query: BusinessSlugCandidate
    ): Promise<{ data: SlugAvailabilityResponse }> {
        const status = await this.businessesService.checkSlugAvailability(
            business,
            query.slug,
            user._id.toString()
        );
        return { data: { slug: query.slug, status } };
    }

    /**
     * Sprint 20 — кладе бажане вільне ім'я на холд за користувачем (free-flow на
     * Save). Повертає бронь з моментом спливу для inline-апселу і відліку.
     */
    @Post(':slug/slug-reservation')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.CREATED)
    async reserveSlug(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument,
        @Body(new ZodValidationPipe(BusinessSlugCandidateSchema))
        dto: BusinessSlugCandidate
    ): Promise<{ data: SlugReservationView }> {
        const reservation = await this.businessesService.reserveSlug(
            business,
            dto.slug,
            user._id.toString()
        );
        return { data: toSlugReservationView(reservation) };
    }

    @Delete(':slug')
    @UseGuards(BusinessAccessGuard)
    @HttpCode(HttpStatus.OK)
    async delete(
        @CurrentUser() user: UserDocument,
        @CurrentBusiness() business: BusinessDocument
    ): Promise<{
        data: { affectedAccounts: number; affectedInvoices: number };
    }> {
        // Sprint 9 §SP-5 — повертаємо обидва counters cascade-видалених
        // (accounts + invoices). Frontend toast: "Видалено бізнес, {N}
        // рахунків і {M} інвойсів".
        const result = await this.businessesService.delete(business);
        // Sprint 19 — видалення міняє склад bucket-ів (хто «виживає» у межах
        // ліміту), а білінг-тригера тут немає. Без перерахунку юзер, що видалив
        // вцілілий бізнес, назавжди лишився б із заблокованим іншим, хоч той
        // уже в межах безкоштовного ліміту. Best-effort (метод сам логує збої)
        // під спільним білінг-локом проти race з вебхуком.
        await this.reconciliation.reconcileUnderLock(user._id.toString());
        return { data: result };
    }
}
