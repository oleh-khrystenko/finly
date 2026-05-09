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
    type Business,
} from '../entities/business';
import { slugPresetSchema } from '../entities/invoice';
import { ibanZod } from '../validation/iban';
import { individualTaxIdZod, legalEntityTaxIdZod } from '../validation/tax-id';

/**
 * Sprint 3 §3.1 + Sprint 7 §SP-3/§SP-4 — write-side контракти Business для
 * cabinet endpoint-ів і public-фетчу. Single source of truth для API DTO
 * (`createZodDto`) і frontend RHF-resolver-ів.
 *
 * **Що жодна з write-схем (Create/Update) не приймає** — поля, що генеруються
 * БД або сервісом, або керуються окремими flow:
 *  - `id`, `createdAt`, `updatedAt` — генеруються БД.
 *  - `slug`, `slugLower` — slug-генератор сервера (Sprint 3 рішення B3:
 *    Free-tier — random 8 chars). Sprint 6 додасть окремий vanity-edit
 *    endpoint, **не** через розширення Update-схеми.
 *  - `ownerId`, `managers` — резолвить service з `userId + worksAsBookkeeper`,
 *    клієнт не передає.
 *  - `deletedAt` — Sprint 3 робить hard-delete (рішення C2); soft-delete не
 *    керується через API.
 *
 * **`type` приймається тільки на створенні** (Sprint 7 §SP-8): бізнес фіксує
 * юр-форму при `POST /businesses/me`, далі immutable. Update-DTO `type`
 * навмисно виключає — зміна `type` каскадно ламає taxId-формат, taxation-
 * presence, isVatPayer-presence (4 revalidation-и). Якщо ФОП юридично став
 * ТОВ — це новий бізнес, не PATCH.
 *
 * **Coupled-rule `taxationSystem × isVatPayer`** (рішення C1) дублюється тут і
 * в entity-схемі: API-side Zod це safety-net на випадок drift-у frontend-схеми
 * або прямого curl-у; помилка прокидається `ZodValidationPipe` як 400
 * `VALIDATION_ERROR`. Frontend бачить inline-помилку через ту саму схему.
 */

const acceptedBanksField = z.array(bankCodeSchema).min(1, {
    message: 'ACCEPTED_BANKS_REQUIRED',
});

/**
 * Coupled VAT × taxationSystem refine — застосовується **per-variant** у
 * fop / tov create-варіантах. Для individual / organization variants поля
 * фізично відсутні, refine не потрібен.
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
 * Sprint 7 §SP-3 + §SP-4 — `CreateBusinessSchema` як `z.discriminatedUnion`
 * по `type`. Кожен variant явно описує **тільки ті поля, що мають юридичний
 * сенс для цього типу**:
 *  - `individual` / `organization` — без taxation-полів (поля фізично
 *    відсутні у TS-типі; frontend handler-и не зможуть передати їх без
 *    compile-error).
 *  - `fop` / `tov` — з `taxationSystem` + `isVatPayer` + per-variant
 *    coupled-refine.
 *  - `requisites.taxId` валідатор обирається per-variant: `individualTaxIdZod`
 *    (10 цифр + checksum) для individual / fop; `legalEntityTaxIdZod`
 *    (8 цифр) для tov / organization.
 *
 * **Чому discriminatedUnion, а не single-shape з conditional refine**: TS-
 * exhaustiveness — додавання нового `BusinessType` без оновлення схеми дає
 * compile-error на `z.discriminatedUnion(...)` literal-tuple. Conditional
 * refine на single-shape обманює type-checker і дозволяє skip-нути нову
 * branch.
 *
 * **`acceptedBanks` — мінімум 1** (рішення B6: дефолт усі 11 на UI, але
 * в контракті — не-пустий список; нульовий стан неможливий).
 */
const createIndividualVariant = z
    .object({
        type: z.literal('individual'),
        name: businessNameSchema,
        requisites: z.object({
            iban: ibanZod,
            taxId: individualTaxIdZod,
        }),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: acceptedBanksField,
    })
    .strict();

const createFopVariant = z
    .object({
        type: z.literal('fop'),
        name: businessNameSchema,
        requisites: z.object({
            iban: ibanZod,
            taxId: individualTaxIdZod,
        }),
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: acceptedBanksField,
    })
    .strict()
    .refine(taxationVatCheck, taxationVatRefineOptions);

const createTovVariant = z
    .object({
        type: z.literal('tov'),
        name: businessNameSchema,
        requisites: z.object({
            iban: ibanZod,
            taxId: legalEntityTaxIdZod,
        }),
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: acceptedBanksField,
    })
    .strict()
    .refine(taxationVatCheck, taxationVatRefineOptions);

const createOrganizationVariant = z
    .object({
        type: z.literal('organization'),
        name: businessNameSchema,
        requisites: z.object({
            iban: ibanZod,
            taxId: legalEntityTaxIdZod,
        }),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: acceptedBanksField,
    })
    .strict();

export const CreateBusinessSchema = z.discriminatedUnion('type', [
    createIndividualVariant,
    createFopVariant,
    createTovVariant,
    createOrganizationVariant,
]);

export type CreateBusinessRequest = z.infer<typeof CreateBusinessSchema>;

/**
 * `UpdateBusinessSchema` — partial по edit-allowed підмножині. Sprint 7 залишає
 * **single-shape `.partial().strict()`** (НЕ discriminated union), бо partial-
 * PATCH не несе `type` (immutable post-creation, §SP-8).
 *
 * **`.strict()` modifier** обов'язковий — невідомі ключі payload-а (`slug`,
 * `type`, `ownerId`, `managers`, `slugLower`) повинні бути reject-ом, не
 * silent-ignore. Sprint 3 §3.2 фіксує цей контракт як **єдиний layer**
 * захисту від slug-mutation: schema → ZodValidationPipe → 400; service
 * не дублює перевірку, бо TypeScript `UpdateBusinessRequest` просто не
 * містить цих ключів.
 *
 * **Type-binding для `requisites.taxId` і `taxation-fields`** — на service-
 * layer (`BusinessesService.update` читає document-resident `type` з БД,
 * валідує проти PATCH-payload-у). DTO-Zod не має `type`-context-у; перевірки
 * живуть там, де `type` доступний без додаткового round-trip.
 *
 * Sub-schema `BusinessRequisitesSchema.taxId: payerTaxIdZod` (union
 * RNOKPP ∪ ЄДРПОУ) reject-ить **structurally** garbage таксайди; type-
 * binding (RNOKPP-on-tov, EDRPOU-on-individual) додає service-layer.
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
        /**
         * Sprint 7 §SP-3 — `nullable()` пропускає `null` через DTO-рівень,
         * щоб service-layer міг кинути type-aware код замість generic
         * `VALIDATION_ERROR`. Подальша валідація на write-path:
         *  - `type ∈ {fop, tov}` + PATCH `null` → 400 `TAXATION_REQUIRED_FOR_TYPE`
         *    ("оберіть систему оподаткування" — поле обов'язкове для цього типу).
         *  - `type ∈ {individual, organization}` + PATCH non-null → 400
         *    `TAXATION_NOT_APPLICABLE_FOR_TYPE` ("приберіть поле" — воно
         *    недоступне для цього типу).
         *  - `type ∈ {individual, organization}` + PATCH `null` → також
         *    `TAXATION_NOT_APPLICABLE_FOR_TYPE` (PATCH семантично
         *    сигналізує "змінити", що для immutable-null-стану не має сенсу).
         *
         * `type` immutable post-creation (§SP-8) — реальний шлях "перейти з
         * fop на individual" — створення нового бізнесу, не PATCH. DTO дає
         * null лише як технічну поверхню для специфічних error-кодів.
         */
        taxationSystem: taxationSystemSchema.nullable(),
        isVatPayer: z.boolean().nullable(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: acceptedBanksField,
        seoIndexEnabled: z.boolean(),
        /**
         * Sprint 4 §4.1 — bizness-level дефолт slug-preset для нових інвойсів.
         * Без цього розширення SP-1-рішення про business-level дефолт пресету
         * (Q §2.3 #2 closure) — dead config. `null` = "не визначено", форма
         * створення фолбеком використовує global system default `simple`
         * (§4.5). Поле незалежне (без cross-field rules) — service-layer
         * coupled-check не потрібен.
         */
        invoiceSlugPresetDefault: slugPresetSchema.nullable(),
    })
    .partial()
    .strict()
    .refine(
        (data) => {
            // Coupled refine активний лише коли обидва поля передані і
            // обидва не-null. null-сторона — service-layer відповідальність
            // (читає document-resident `type`).
            if (
                data.taxationSystem === undefined ||
                data.isVatPayer === undefined
            ) {
                return true;
            }
            if (data.taxationSystem === null || data.isVatPayer === null) {
                return true;
            }
            return (
                isVatAllowedTaxationSystem(data.taxationSystem) ||
                !data.isVatPayer
            );
        },
        {
            message: 'INVALID_VAT_FOR_TAXATION_SYSTEM',
            path: ['isVatPayer'],
        }
    );

export type UpdateBusinessRequest = z.infer<typeof UpdateBusinessSchema>;

/**
 * `PublicBusinessSchema` — view-схема для public endpoint
 * (`GET /businesses/public/:slug`). Sprint 3 рішення C4 + E3 + A2:
 *   - Visible-поля: `type`, `name`, `slug`, `acceptedBanks`,
 *     `seoIndexEnabled`. Реквізити (IBAN, ІПН) **не** віддаються JSON-ом
 *     напряму — leak-сурфейс лишається через NBU payload-link (той самий
 *     vector як QR PNG; payload містить реквізити у Base64URL).
 *   - `seoIndexEnabled` для рендеру `<meta name="robots">` у Server Component.
 *   - `nbuLinks` — pre-built NBU payload-link URLs для двох host-варіантів
 *     (Sprint 3 рішення A2: дві активні CTA "Інший банк"). Frontend рендерить
 *     `<a href={nbuLinks.primary}>` → ОС ловить через app-link і відкриває
 *     банк-додаток з реквізитами. Без цих URLs кнопки не функціональні.
 *     Server-side побудова: `QrService.buildNbuPayloadLinkForInput(input, host)`.
 */
/**
 * Sprint 4 §4.4 — list/getBySlug response shape для cabinet-зони.
 * `Business` (entity-Zod) + cheap aggregate `invoicesCount: number`.
 *
 * **View-only поле**, не частина `Business`-entity (entity ≠ persistence-shape;
 * entity описує invariants single-document-state). Окремий contract-тип
 * робить shape явною для обох сторін: backend `BusinessesService.getOwnedAnd-
 * ManagedWithInvoicesCount`/`BusinessesController.getBySlug` декларують
 * повернення цього типу; frontend `shared/api/businesses` re-exports замість
 * локального alias.
 */
export type BusinessWithInvoicesCount = Business & {
    invoicesCount: number;
};

export const PublicBusinessSchema = z.object({
    type: businessTypeSchema,
    name: businessNameSchema,
    slug: businessSlugSchema,
    acceptedBanks: z.array(bankCodeSchema),
    seoIndexEnabled: z.boolean(),
    nbuLinks: z.object({
        primary: z.string().url(),
        legacy: z.string().url(),
    }),
});

export type PublicBusinessView = z.infer<typeof PublicBusinessSchema>;
