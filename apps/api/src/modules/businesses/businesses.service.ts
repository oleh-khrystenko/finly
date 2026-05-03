import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
    RESPONSE_CODE,
    isVatAllowedTaxationSystem,
    type CreateBusinessRequest,
    type UpdateBusinessRequest,
} from '@finly/types';

import { Business, BusinessDocument } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 3 §3.2 — primary CRUD service для бізнесів cabinet-зони.
 *
 * **Slug-нормалізація.** `slug` — case-preserved (display); `slugLower` —
 * нормалізована форма для unique-index і lookup-у. Сервіс — єдина точка, де
 * робиться `slug.toLowerCase()`; Mongoose pre-save hook **навмисно не
 * використовуємо** (sprint plan §3.1: "переваги другому варіанту, бо явніше
 * і тестується ізольовано").
 *
 * **Ownership правило (рішення E5).**
 *   - `worksAsBookkeeper === true` → `ownerId = null`, `managers = [userId]`
 *     (бізнес ведений бухгалтером для клієнта, що ще не у Finly).
 *   - `worksAsBookkeeper === false` → `ownerId = userId`, `managers = []`.
 *   Toggle живе на user-документі; service читає поточний стан з аргументу
 *   `isBookkeeperMode` (controller дістає з `user.worksAsBookkeeper` і пасує
 *   далі — щоб service не depend-ив на `UsersService` циркулярно).
 *
 * **`getOwnedAndManaged` — фільтр для toggle-перемикання** (E5):
 *   - bookkeeper ON → ownerless-бізнеси, де userId ∈ managers.
 *   - bookkeeper OFF → owned-бізнеси, де ownerId === userId.
 *   Toggle-перемикання тільки **ховає/показує** бізнеси, не архівує.
 *
 * **`update` — coupled VAT × taxationSystem cross-field check.**
 *   Sprint 3 §3.1 §3.2: write-DTO Zod skip-ить refine, якщо передано тільки
 *   одне з полів пари. Service вирішує крайові кейси: при partial-update,
 *   що містить `isVatPayer=true` без `taxationSystem` (frontend inline-edit
 *   тільки VAT-чекбоксу), читаємо існуючий `taxationSystem` з документа і
 *   валідуємо пару. Те саме для `taxationSystem` без `isVatPayer`. Якщо
 *   результуюча пара невалідна — `ValidationError` з тим самим кодом, що й
 *   write-DTO refine (`INVALID_VAT_FOR_TAXATION_SYSTEM`).
 */
@Injectable()
export class BusinessesService {
    private readonly logger = new Logger(BusinessesService.name);

    constructor(
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        private readonly slugGenerator: SlugGeneratorService
    ) {}

    async create(
        userId: string,
        dto: CreateBusinessRequest,
        isBookkeeperMode: boolean
    ): Promise<BusinessDocument> {
        const userObjectId = new Types.ObjectId(userId);
        const slug = await this.slugGenerator.generateRandomSlug();

        const ownership = isBookkeeperMode
            ? { ownerId: null, managers: [userObjectId] }
            : { ownerId: userObjectId, managers: [] as Types.ObjectId[] };

        try {
            return await this.businessModel.create({
                ...dto,
                slug,
                slugLower: slug.toLowerCase(),
                ...ownership,
            });
        } catch (err) {
            // Race condition: SlugGenerator щойно перевірив `slugLower` як
            // вільний, але паралельний create зайняв його раніше за наш
            // insert. Для 8-char × 62-alphabet алфавіту вірогідність ≈ 0,
            // але defensively ловимо MongoServerError 11000 і кидаємо
            // SLUG_GENERATION_FAILED з логом — це сигнал для алерту, не
            // user-facing помилка.
            if (
                err instanceof Error &&
                'code' in err &&
                (err as { code: number }).code === 11000
            ) {
                this.logger.error(
                    `Slug collision race for "${slug}" (slugLower=${slug.toLowerCase()})`
                );
                throw new InternalServerErrorException({
                    code: RESPONSE_CODE.SLUG_GENERATION_FAILED,
                    message: 'Slug collision; please retry',
                });
            }
            throw err;
        }
    }

    async getOwnedAndManaged(
        userId: string,
        isBookkeeperMode: boolean
    ): Promise<BusinessDocument[]> {
        const userObjectId = new Types.ObjectId(userId);
        const filter = isBookkeeperMode
            ? { ownerId: null, managers: userObjectId }
            : { ownerId: userObjectId };
        return this.businessModel
            .find(filter)
            .sort({ createdAt: -1 })
            .exec();
    }

    /**
     * Case-insensitive lookup. Спільний primitive для cabinet (через guard) і
     * public controller. Повертає `null` якщо не знайдено — caller вирішує,
     * як перетворити на 404 (різні response-shape для cabinet vs public).
     */
    async getBySlug(slug: string): Promise<BusinessDocument | null> {
        return this.businessModel
            .findOne({ slugLower: slug.toLowerCase() })
            .exec();
    }

    async update(
        slug: string,
        dto: UpdateBusinessRequest
    ): Promise<BusinessDocument> {
        // Service-layer cross-field VAT × taxationSystem check для partial-update.
        // Якщо передано лише одне з пари — читаємо existing, валідуємо комбо.
        if (dto.isVatPayer !== undefined || dto.taxationSystem !== undefined) {
            const existing = await this.businessModel
                .findOne({ slugLower: slug.toLowerCase() })
                .exec();
            if (!existing) {
                throw new NotFoundException({
                    code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                    message: 'Business not found during update',
                });
            }
            const nextTaxation =
                dto.taxationSystem ?? existing.taxationSystem;
            const nextVat =
                dto.isVatPayer !== undefined
                    ? dto.isVatPayer
                    : existing.isVatPayer;
            if (nextVat && !isVatAllowedTaxationSystem(nextTaxation)) {
                // Re-use коду з Zod-refine. AllExceptionsFilter маппить
                // BadRequestException → 400; explicit code у response
                // carry-ить точну причину для frontend (mapApiCode →
                // inline-помилка під полем "Платник ПДВ").
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM,
                    message:
                        'Платник ПДВ дозволений лише на спрощеній-3 або загальній системі',
                });
            }
        }

        const updated = await this.businessModel
            .findOneAndUpdate(
                { slugLower: slug.toLowerCase() },
                { $set: dto },
                { new: true, runValidators: true }
            )
            .exec();
        if (!updated) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business disappeared between guard and update',
            });
        }
        return updated;
    }

    /**
     * Sprint 3 рішення C2: hard-delete одразу. Slug звільняється — наступний
     * `create` може його зайняти. Frontend-Undo (5s toast) живе на web-стороні
     * як optimistic UI; цей method виконується тільки якщо timer пройшов
     * без cancel-у. Sprint 4 додасть warning у delete-confirm "є активні
     * рахунки" через `Invoice.exists({ businessId })` — поза скоупом цього
     * service.
     */
    async delete(slug: string): Promise<void> {
        const result = await this.businessModel
            .deleteOne({ slugLower: slug.toLowerCase() })
            .exec();
        if (result.deletedCount === 0) {
            // Race з паралельним delete-ом або документ зник між guard-ом і
            // викликом. Ідемпотентний 404.
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found during delete',
            });
        }
    }
}
