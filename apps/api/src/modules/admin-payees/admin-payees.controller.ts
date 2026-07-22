import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import {
    CreateSystemPayeeSchema,
    RESPONSE_CODE,
    type AccountWithCounts,
    type CreateSystemPayeeRequest,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { AccountsService } from '../accounts/accounts.service';
import type { AccountDocument } from '../accounts/schemas/account.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { SetCatalogVisibilityDto } from '../businesses/dto/set-catalog-visibility.dto';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import type { UserDocument } from '../users/schemas/user.schema';
import { CreateSystemPayeeAccountDto } from './dto/create-system-payee-account.dto';
import { UpdateSystemPayeeAccountDto } from './dto/update-system-payee-account.dto';
import { UpdateSystemPayeeDto } from './dto/update-system-payee.dto';

/**
 * Sprint 29 — адмін-CRUD системних отримувачів (податкова, фонди). Отримувач це
 * звичайний Business без власника з прапором `isSystem`; реквізити всередині це
 * звичайні Account. Тому переюзуємо `BusinessesService` / `AccountsService`
 * замість дублювання створення, а адмінський обхід перевірки власності дає
 * guard-chain на класі (`JwtActiveGuard` → `AdminGuard`).
 *
 * `@SkipOnboarding` — staff-інструмент, не пов'язаний з онбордингом ФОП (як
 * `GuidesAdminController`); інакше глобальний OnboardingInterceptor блокував би
 * адміна з незаповненим профілем.
 */
@Controller('admin/payees')
@UseGuards(JwtActiveGuard, AdminGuard)
@SkipOnboarding()
export class AdminPayeesController {
    constructor(
        private readonly businessesService: BusinessesService,
        private readonly accountsService: AccountsService
    ) {}

    @Get()
    async list(): Promise<{ data: BusinessDocument[] }> {
        const data = await this.businessesService.listSystemPayees();
        return { data };
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(
        // `CreateSystemPayeeSchema` — discriminatedUnion по `type`; `createZodDto`
        // не підтримує union-output для class-extends, тож param-level pipe (той
        // самий патерн, що `BusinessesController.create`).
        @Body(new ZodValidationPipe(CreateSystemPayeeSchema))
        dto: CreateSystemPayeeRequest
    ): Promise<{ data: BusinessDocument }> {
        const business = await this.businessesService.createSystemPayee(dto);
        return { data: business };
    }

    @Get(':slug')
    async getOne(@Param('slug') slug: string): Promise<{
        data: { business: BusinessDocument; accounts: AccountWithCounts[] };
    }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const accounts = await this.accountsService.listForBusinessWithCounts(
            business._id
        );
        return { data: { business, accounts } };
    }

    /**
     * Sprint 29 — редагування системного отримувача: назва, taxId, оподаткування,
     * шаблон призначення з маркерами, категорія і slug (поза Brand-гейтингом).
     * `getSystemPayeeBySlugOrThrow` гарантує, що редагується саме системний запис
     * (не чужий бізнес користувача); slug адміна — контекст для slug-rename броні.
     */
    @Patch(':slug')
    async update(
        @CurrentUser() admin: UserDocument,
        @Param('slug') slug: string,
        @Body() dto: UpdateSystemPayeeDto
    ): Promise<{ data: BusinessDocument }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const updated = await this.businessesService.updateSystemPayee(
            business.slug,
            dto,
            admin._id.toString()
        );
        return { data: updated };
    }

    @Delete(':slug')
    @HttpCode(HttpStatus.OK)
    async delete(@Param('slug') slug: string): Promise<{
        data: { affectedAccounts: number; affectedInvoices: number };
    }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const result = await this.businessesService.delete(business);
        return { data: result };
    }

    /**
     * Sprint 29 — тогл видимості системного отримувача у каталозі (адмінський
     * миттєвий важіль: приховати/показати без ownership-перевірки). Системний
     * запис проходить `canEnterCatalog` у сервісі як допущений.
     */
    @Patch(':slug/catalog-visibility')
    async setCatalogVisibility(
        @Param('slug') slug: string,
        @Body() dto: SetCatalogVisibilityDto
    ): Promise<{ data: BusinessDocument }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const updated = await this.businessesService.setCatalogVisibility(
            business,
            dto.visible
        );
        return { data: updated };
    }

    /**
     * Sprint 29 — реквізити системного отримувача. Окремий від кабінетного DTO,
     * бо призначення тут приймає маркери підстановки (`{taxId}`, `{period}`):
     * саме per-account призначення дозволяє одному ГУ ДПС мати рахунок під ЄСВ і
     * рахунок під військовий збір з різними текстами призначення.
     */
    @Post(':slug/accounts')
    @HttpCode(HttpStatus.CREATED)
    async createAccount(
        @Param('slug') slug: string,
        @Body() dto: CreateSystemPayeeAccountDto
    ): Promise<{ data: AccountDocument }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const account = await this.accountsService.create(business, dto);
        return { data: account };
    }

    /**
     * Sprint 29 — редагування реквізитів системного отримувача: назва, красивий
     * slug і власне призначення платежу.
     *
     * Чому окремий адмін-роут, а не кабінетний PATCH: `BusinessAccessGuard`
     * резолвить бізнес за `ownerId`/`managers`, а у системного запису обидва
     * порожні, тож кабінетний шлях до цих реквізитів недосяжний за побудовою.
     *
     * `isBranded: true` — системний запис поза Brand-гейтингом (те саме рішення,
     * що в `updateSystemPayee`); `consumeSlugReservation: false` — rename не
     * чіпає власну slug-бронь адміна. Сам rename іде штатним шляхом сервісу:
     * `AccountSlugHistory` + 308-редіректи + anti-squatting.
     */
    @Patch(':slug/accounts/:accountSlug')
    async updateAccount(
        @CurrentUser() admin: UserDocument,
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Body() dto: UpdateSystemPayeeAccountDto
    ): Promise<{ data: AccountDocument }> {
        const { account } = await this.lookupAccountOrThrow(slug, accountSlug);
        const updated = await this.accountsService.update(
            account,
            dto,
            true,
            admin._id.toString(),
            true,
            { consumeSlugReservation: false }
        );
        return { data: updated };
    }

    /**
     * Sprint 29 — тогл видимості реквізитів системного отримувача у каталозі.
     * Дефолт після створення прихований; адмін вмикає явно (симетрично тому, як
     * користувач вмикає свої реквізити після схвалення).
     */
    @Patch(':slug/accounts/:accountSlug/catalog-visibility')
    async setAccountCatalogVisibility(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string,
        @Body() dto: SetCatalogVisibilityDto
    ): Promise<{ data: AccountDocument }> {
        const { business, account } = await this.lookupAccountOrThrow(
            slug,
            accountSlug
        );
        const updated = await this.accountsService.setCatalogVisibility(
            account,
            business,
            dto.visible
        );
        return { data: updated };
    }

    @Delete(':slug/accounts/:accountSlug')
    @HttpCode(HttpStatus.OK)
    async deleteAccount(
        @Param('slug') slug: string,
        @Param('accountSlug') accountSlug: string
    ): Promise<{ data: { affectedInvoices: number } }> {
        const { account } = await this.lookupAccountOrThrow(slug, accountSlug);
        const result = await this.accountsService.delete(account);
        return { data: result };
    }

    /**
     * Резолв пари `(системний отримувач, його реквізити)` для адмін-операцій.
     * `getSystemPayeeBySlugOrThrow` гарантує, що адмінська поверхня не дістане
     * бізнес користувача; пошук рахунку — суворо у межах знайденого отримувача.
     */
    private async lookupAccountOrThrow(
        slug: string,
        accountSlug: string
    ): Promise<{ business: BusinessDocument; account: AccountDocument }> {
        const business =
            await this.businessesService.getSystemPayeeBySlugOrThrow(slug);
        const account = await this.accountsService.getBySlug(
            business._id,
            accountSlug
        );
        if (!account) {
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Account not found',
            });
        }
        return { business, account };
    }
}
