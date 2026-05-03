import { z } from 'zod';

import { isVatAllowedTaxationSystem } from '../enums/taxation-system';
import {
    BusinessRequisitesSchema,
    bankCodeSchema,
    businessNameSchema,
    businessPaymentPurposeTemplateSchema,
    businessSlugSchema,
    businessTypeSchema,
    taxationSystemSchema,
} from '../entities/business';

/**
 * Sprint 3 §3.1 — write-side контракти Business для cabinet endpoint-ів і
 * public-фетчу. Single source of truth для API DTO (`createZodDto`) і
 * frontend RHF-resolver-ів.
 *
 * **Що НЕ кладемо у write-схеми:**
 *  - `id`, `createdAt`, `updatedAt` — генеруються БД.
 *  - `slug`, `slugLower` — slug-генератор сервера (Sprint 3 рішення B3:
 *    Free-tier — random 8 chars). Sprint 6 додасть окремий vanity-edit
 *    endpoint, **не** через розширення Update-схеми.
 *  - `type` — immutable після створення (Sprint 4+ при появі ТОВ можуть
 *    додатись правила міграції; зараз тільки `'fop'`).
 *  - `ownerId`, `managers` — резолвить service з `userId + worksAsBookkeeper`,
 *    клієнт не передає.
 *  - `deletedAt` — Sprint 3 робить hard-delete (рішення C2); soft-delete не
 *    керується через API.
 *
 * **Coupled-rule `taxationSystem × isVatPayer`** (рішення C1) дублюється тут і
 * в entity-схемі: API-side Zod це safety-net на випадок drift-у frontend-схеми
 * або прямого curl-у; помилка прокидається `ZodValidationPipe` як 400
 * `VALIDATION_ERROR`. Frontend бачить inline-помилку через ту саму схему.
 */

const taxationVatCheck = (data: {
    taxationSystem: z.infer<typeof taxationSystemSchema>;
    isVatPayer: boolean;
}): boolean =>
    !data.isVatPayer || isVatAllowedTaxationSystem(data.taxationSystem);

const taxationVatRefineOptions = {
    message: 'INVALID_VAT_FOR_TAXATION_SYSTEM',
    path: ['isVatPayer'] as PropertyKey[],
};

/**
 * `CreateBusinessSchema` — повний payload з 4-крокового wizard-а (§3.7).
 * Усі бізнес-поля required; slug сервер генерує сам, ownership резолвить
 * з `worksAsBookkeeper`-toggle користувача.
 *
 * **`acceptedBanks` — мінімум 1** (рішення B6: дефолт усі 11 на UI, але
 * в контракті — не-пустий список; нульовий стан неможливий).
 */
export const CreateBusinessSchema = z
    .object({
        type: businessTypeSchema,
        name: businessNameSchema,
        requisites: BusinessRequisitesSchema,
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: z.array(bankCodeSchema).min(1, {
            message: 'ACCEPTED_BANKS_REQUIRED',
        }),
    })
    .strict()
    .refine(taxationVatCheck, taxationVatRefineOptions);

export type CreateBusinessRequest = z.infer<typeof CreateBusinessSchema>;

/**
 * `UpdateBusinessSchema` — partial по edit-allowed підмножині.
 *
 * **`.strict()` modifier** обов'язковий — невідомі ключі payload-а (`slug`,
 * `type`, `ownerId`, `managers`, `slugLower`) повинні бути reject-ом, не
 * silent-ignore. Sprint 3 §3.2 фіксує цей контракт як **єдиний layer**
 * захисту від slug-mutation: schema → ZodValidationPipe → 400; service
 * не дублює перевірку, бо TypeScript `UpdateBusinessRequest` просто не
 * містить цих ключів.
 *
 * **Coupled-валідація `taxationSystem × isVatPayer`** активується тільки
 * якщо клієнт передав **обидва** поля у одному PATCH — щоб inline-edit
 * `isVatPayer` без `taxationSystem` не падав з помилкою (frontend читає
 * поточний `taxationSystem` з view-state і відправляє тільки змінене поле,
 * де refine не може перевірити пару). Server-side coupled-check для змін
 * `isVatPayer` без поточного `taxationSystem` живе у `BusinessesService.update`
 * (читає documentного `taxationSystem`, перевіряє пару при save) — це поза
 * write-DTO Zod, бо вимагає DB-доступу.
 */
export const UpdateBusinessSchema = z
    .object({
        name: businessNameSchema,
        requisites: BusinessRequisitesSchema,
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: z.array(bankCodeSchema).min(1, {
            message: 'ACCEPTED_BANKS_REQUIRED',
        }),
        seoIndexEnabled: z.boolean(),
    })
    .partial()
    .strict()
    .refine(
        (data) =>
            data.taxationSystem === undefined ||
            data.isVatPayer === undefined ||
            isVatAllowedTaxationSystem(data.taxationSystem) ||
            !data.isVatPayer,
        {
            message: 'INVALID_VAT_FOR_TAXATION_SYSTEM',
            path: ['isVatPayer'],
        }
    );

export type UpdateBusinessRequest = z.infer<typeof UpdateBusinessSchema>;

/**
 * `PublicBusinessSchema` — view-схема для public endpoint
 * (`GET /businesses/public/:slug`). Sprint 3 рішення C4 + E3:
 *   - **5 whitelist-полів**: `type`, `name`, `slug`, `acceptedBanks`,
 *     `seoIndexEnabled`. Реквізити (IBAN, ІПН) **не** віддаються JSON-ом —
 *     доступні клієнту тільки через QR. Single source of truth для leak-сурфейсу.
 *   - `seoIndexEnabled` потрапляє у view, бо public Server Component читає
 *     його напряму для рендеру `<meta name="robots">`.
 */
export const PublicBusinessSchema = z.object({
    type: businessTypeSchema,
    name: businessNameSchema,
    slug: businessSlugSchema,
    acceptedBanks: z.array(bankCodeSchema),
    seoIndexEnabled: z.boolean(),
});

export type PublicBusinessView = z.infer<typeof PublicBusinessSchema>;
