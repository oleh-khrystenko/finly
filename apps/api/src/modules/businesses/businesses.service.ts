import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type FilterQuery } from 'mongoose';
import {
    RESPONSE_CODE,
    VAT_ALLOWED_TAXATION_SYSTEMS,
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
 *   одне з полів пари. Service атомарно перевіряє пару у `findOneAndUpdate`
 *   через `$expr`-filter — incoming-літерал замінює `'$<fieldname>'`-reference
 *   на існуюче поле документа, тож happy path — single round-trip. Якщо
 *   filter блокує update (повертає null), fallback `exists()`-запит
 *   розрізняє 404 (документу немає) vs 400 (`INVALID_VAT_FOR_TAXATION_SYSTEM`).
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
        return this.businessModel.find(filter).sort({ createdAt: -1 }).exec();
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
        // Atomic update + coupled VAT × taxationSystem check у `$expr`-filter
        // — single round-trip у happy path. `$expr` обчислює пару
        // (incoming-or-existing isVatPayer, incoming-or-existing taxationSystem)
        // і блокує update, якщо пара (true, ∉ VAT_ALLOWED_TAXATION_SYSTEMS).
        // Mongo aggregation expression: literal-значення з dto замінює
        // `'$<fieldname>'`-reference на існуюче поле документа.
        const slugLower = slug.toLowerCase();
        const hasCoupledFields =
            dto.isVatPayer !== undefined || dto.taxationSystem !== undefined;

        const filter: FilterQuery<BusinessDocument> = { slugLower };
        if (hasCoupledFields) {
            const nextVat =
                dto.isVatPayer !== undefined ? dto.isVatPayer : '$isVatPayer';
            const nextTax = dto.taxationSystem ?? '$taxationSystem';
            // Coupled invariant: `NOT (nextVat=true AND nextTax ∉ allowed)`.
            // De Morgan → `nextVat ≠ true OR nextTax ∈ allowed` — без `$not`/
            // `$and` nesting, що в aggregation expression потребує масивної
            // форми `{$not:[<expr>]}` і легко спричиняє runtime-помилки.
            filter.$expr = {
                $or: [
                    { $ne: [nextVat, true] },
                    { $in: [nextTax, VAT_ALLOWED_TAXATION_SYSTEMS] },
                ],
            };
        }

        const updated = await this.businessModel
            .findOneAndUpdate(
                filter,
                { $set: dto },
                { new: true, runValidators: true }
            )
            .exec();
        if (updated) return updated;

        // Null = filter не пропустив update. Якщо coupled-fields у dto,
        // розрізняємо 400 (coupled violation) vs 404 (документу немає)
        // одним додатковим `exists()`-запитом — тільки на error-path,
        // happy-path лишається 1-roundtrip.
        if (hasCoupledFields) {
            const exists = await this.businessModel.exists({ slugLower });
            if (exists) {
                throw new BadRequestException({
                    code: RESPONSE_CODE.INVALID_VAT_FOR_TAXATION_SYSTEM,
                    message:
                        'Платник ПДВ дозволений лише на спрощеній-3 або загальній системі',
                });
            }
        }
        throw new NotFoundException({
            code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
            message: 'Business disappeared between guard and update',
        });
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
