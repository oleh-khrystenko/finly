import { z } from 'zod';

import {
    businessNameSchema,
    businessPaymentPurposeTemplateSchema,
    businessSlugSchema,
    businessTypeSchema,
    taxationSystemSchema,
    type Business,
} from '../entities/business';
import {
    isTaxationAllowedForType,
    isVatAllowedTaxationSystem,
} from '../enums/taxation-system';
import {
    individualTaxIdZod,
    legalEntityTaxIdZod,
    payerTaxIdZod,
} from '../validation/tax-id';
import { PublicAccountListItemSchema } from './accounts';

/**
 * Sprint 3 §3.1 + Sprint 7 §SP-3/§SP-4 + Sprint 9 §SP-1 — write-side контракти
 * Business для cabinet endpoint-ів і public-фетчу. Single source of truth для
 * API DTO (`createZodDto`) і frontend RHF-resolver-ів.
 *
 * **Sprint 9 рефакторинг:**
 *  - `requisites`-wrapper видалено повністю. `iban` переїхав на Account; `taxId`
 *    flatten-ується у top-level field-у Business (write-DTO + read-entity).
 *  - `invoiceSlugPresetDefault` видалено з Update-DTO (переїжджає на Account-DTO,
 *    бо нумерація інвойсів per-account, §SP-6).
 *  - `PublicBusinessSchema` переписаний: був `nbuLinks` (single-account payment-
 *    view) → стає `accounts: PublicAccountListItem[]` (root-list-view).
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

/**
 * Sprint 10 §SP-11 — UUID v4 anti-duplicate token для anon-claim-flow. Optional
 * у write-DTO: cabinet wizard НЕ передає це поле (відсутнє у payload-і →
 * `.strict()` пропускає, бо поле задекларовано optional). Anon-claim прокидає
 * UUID v4, згенерований frontend `crypto.randomUUID()` на CTA-click "Зберегти
 * у кабінет"; backend `BusinessesService.create` робить dedup через partial-
 * unique-compound-index `(ownerId, claimIdempotencyKey)`.
 *
 * Single source of truth для 4 discriminated-union variants — drift двох
 * `claimIdempotencyKey`-полів у `individual`/`fop`/`tov`/`organization`
 * variants виключений.
 */
const claimIdempotencyKeyField = z
    .string()
    .uuid({ message: 'INVALID_CLAIM_IDEMPOTENCY_KEY' })
    .optional();

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
 * Type-binding refine: `taxationSystem ∈ ALLOWED_TAXATION_SYSTEMS_BY_TYPE[type]`.
 * Активний у `createTovVariant` (групи 1/2 єдиного податку для ТОВ заборонені
 * ПКУ розд. XIV гл. 1). У `createFopVariant` не потрібен — ФОП дозволяє всі
 * 4 системи. Update-DTO `UpdateBusinessSchema` не несе `type`; та сама перевірка
 * живе у `BusinessesService.update` (читає document-resident `type`).
 */
const taxationSystemAllowedRefineOptions = {
    message: 'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
    path: ['taxationSystem'] as PropertyKey[],
};

/**
 * Sprint 7 §SP-3 + §SP-4 + Sprint 9 §SP-1 — `CreateBusinessSchema` як
 * `z.discriminatedUnion` по `type`. Кожен variant явно описує **тільки ті поля,
 * що мають юридичний сенс для цього типу**:
 *  - `individual` / `organization` — без taxation-полів (поля фізично
 *    відсутні у TS-типі; frontend handler-и не зможуть передати їх без
 *    compile-error).
 *  - `fop` / `tov` — з `taxationSystem` + `isVatPayer` + per-variant
 *    coupled-refine.
 *  - `taxId` — top-level per-variant validator:
 *    `individualTaxIdZod` (10 цифр + checksum) для individual / fop;
 *    `legalEntityTaxIdZod` (8 цифр) для tov / organization.
 *
 * **Sprint 9 рефакторинг:** `requisites: { iban, taxId }` видалено — `iban`
 * створюється окремо через `POST /businesses/me/{slug}/accounts` (2 sequential
 * claim, §SP-1); `taxId` flatten-ується у top-level field.
 *
 * **Чому discriminatedUnion, а не single-shape з conditional refine**: TS-
 * exhaustiveness — додавання нового `BusinessType` без оновлення схеми дає
 * compile-error на `z.discriminatedUnion(...)` literal-tuple. Conditional
 * refine на single-shape обманює type-checker і дозволяє skip-нути нову
 * branch.
 */
const createIndividualVariant = z
    .object({
        type: z.literal('individual'),
        name: businessNameSchema,
        taxId: individualTaxIdZod,
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        claimIdempotencyKey: claimIdempotencyKeyField,
    })
    .strict();

const createFopVariant = z
    .object({
        type: z.literal('fop'),
        name: businessNameSchema,
        taxId: individualTaxIdZod,
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        claimIdempotencyKey: claimIdempotencyKeyField,
    })
    .strict()
    .refine(taxationVatCheck, taxationVatRefineOptions);

const createTovVariant = z
    .object({
        type: z.literal('tov'),
        name: businessNameSchema,
        taxId: legalEntityTaxIdZod,
        taxationSystem: taxationSystemSchema,
        isVatPayer: z.boolean(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        claimIdempotencyKey: claimIdempotencyKeyField,
    })
    .strict()
    .refine(taxationVatCheck, taxationVatRefineOptions)
    .refine(
        (data) => isTaxationAllowedForType('tov', data.taxationSystem),
        taxationSystemAllowedRefineOptions
    );

const createOrganizationVariant = z
    .object({
        type: z.literal('organization'),
        name: businessNameSchema,
        taxId: legalEntityTaxIdZod,
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        claimIdempotencyKey: claimIdempotencyKeyField,
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
 * **Sprint 9 рефакторинг:**
 *  - `requisites` видалено; `taxId` як top-level optional-field у PATCH.
 *  - `invoiceSlugPresetDefault` видалено — переїхав на Account-DTO
 *    (`UpdateAccountSchema`).
 *
 * **`.strict()` modifier** обов'язковий — невідомі ключі payload-а (`type`,
 * `ownerId`, `managers`, `slugLower`, `requisites`, `invoiceSlugPresetDefault`)
 * повинні бути reject-ом, не silent-ignore.
 *
 * **Type-binding для `taxId` і `taxation-fields`** — на service-layer
 * (`BusinessesService.update` читає document-resident `type` з БД, валідує
 * проти PATCH-payload-у). DTO-Zod не має `type`-context-у; перевірки живуть
 * там, де `type` доступний без додаткового round-trip.
 *
 * Sub-schema `payerTaxIdZod` (union RNOKPP ∪ ЄДРПОУ) reject-ить **structurally**
 * garbage таксайди; type-binding (RNOKPP-on-tov, EDRPOU-on-individual) додає
 * service-layer.
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
        slug: businessSlugSchema,
        taxId: payerTaxIdZod,
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
        seoIndexEnabled: z.boolean(),
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
 * Sprint 9 §SP-4 + §4.4 — list/getBySlug response shape для cabinet-зони.
 * `Business` (entity-Zod) + **два counters**: `accountsCount` + `invoicesCount`.
 *
 * **Раніше `BusinessWithInvoicesCount`** (Sprint 4) — рефакторингується на
 * `BusinessWithCounts` з додаванням `accountsCount`. Frontend cabinet-list
 * рендерить "{accountsCount} рахунків / {invoicesCount} інвойсів" на картці
 * бізнесу — UX-важливо для ФОП з 1 рахунком, що не drill-down-ує (Risk #7
 * mitigation).
 *
 * **View-only поле**, не частина `Business`-entity (entity ≠ persistence-shape;
 * entity описує invariants single-document-state). Окремий contract-тип
 * робить shape явною для обох сторін: backend `BusinessesService.getOwnedAnd-
 * ManagedWithCounts`/`BusinessesController.getBySlug` декларують повернення
 * цього типу; frontend `shared/api/businesses` re-exports замість локального
 * alias.
 */
export type BusinessWithCounts = Business & {
    accountsCount: number;
    invoicesCount: number;
};

/**
 * `PublicBusinessSchema` — view-схема для public endpoint
 * (`GET /businesses/public/:slug`). Sprint 9 §SP-4 рефакторинг:
 *
 *   - **Раніше:** `nbuLinks: {primary, legacy}` — single-account payment-view
 *     на корені (Sprint 3 модель, коли IBAN жив на Business).
 *   - **Тепер:** `accounts: PublicAccountListItem[]` — root-list-view. Frontend
 *     server component (`host-pay/[slug]/page.tsx`) робить switch:
 *     `accounts.length === 0 → empty-state`; `=== 1 → 307-redirect на
 *     {accounts[0].slug}`; `>= 2 → render list-of-cards`.
 *
 * **Visible-поля:** `type`, `name`, `slug`, `seoIndexEnabled`, `accounts`.
 * Реквізити (IBAN, ІПН) **не** віддаються JSON-ом напряму — leak-сурфейс
 * лишається через NBU payload-link на per-account-view (той самий vector як
 * QR PNG; payload містить реквізити у Base64URL).
 *
 * `seoIndexEnabled` для рендеру `<meta name="robots">` у Server Component.
 *
 * `accounts: PublicAccountListItem[]` — кожен item має `slug`, `name`,
 * `bankCode | null`, `ibanMask` (`•{last4}`). UI рендерить картки з bank-label-
 * row conditional на `bankCode !== null` (§SP-9 null-fallback rule).
 */
export const PublicBusinessSchema = z.object({
    type: businessTypeSchema,
    name: businessNameSchema,
    slug: businessSlugSchema,
    seoIndexEnabled: z.boolean(),
    accounts: z.array(PublicAccountListItemSchema),
});

export type PublicBusinessView = z.infer<typeof PublicBusinessSchema>;
