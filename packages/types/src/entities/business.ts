import { z } from 'zod';

import { MVP_BANKS } from '../constants/banks';
import { BUSINESS_TYPES, requiresTaxation } from '../enums/business-type';
import {
    TAXATION_SYSTEMS,
    isVatAllowedTaxationSystem,
} from '../enums/taxation-system';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';
import { ibanZod } from '../validation/iban';
import { isTaxIdValidForType, payerTaxIdZod } from '../validation/tax-id';
import { slugPresetSchema } from './invoice';

/**
 * Бізнес — постійна сутність з унікальною публічною сторінкою
 * (`pay.finly.com.ua/{slug}`). Успадковується інвойсами.
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо, бо це write-side / runtime-time):
 * - Унікальність `slugLower` глобально — Mongoose unique index.
 * - Резервовані slug-и (`qr`, `api`, `host-pay`, …) — slug-генератор.
 * - Free-tier обмеження на `acceptedBanks` — app-layer у Sprint 6.
 *
 * **Length-обмеження `name` і `paymentPurposeTemplate` derived-from-spec**
 * через `effectiveLimit(...)` = MIN по `PAYLOAD_VERSIONS` (Sprint 2 §2.2).
 * Інваріант: будь-який валідно збережений Business може згенерувати валідний
 * QR для будь-якої з підтримуваних версій.
 *
 * **Coupled-інваріанти (refine-only):**
 * 1. `ownerId === null ⇒ managers.length ≥ 1` — ownerless-бізнес без керівників
 *    — невалідний стан БД (нема як до нього достукатись).
 * 2. `requiresTaxation(type) ⇔ (taxationSystem !== null && isVatPayer !== null)`
 *    — Sprint 7 §SP-3 інваріант iff. `fop`/`tov` мусять мати taxation-поля;
 *    `individual`/`organization` мусять мати їх null. Backward-direction
 *    (garbage-taxation у не-taxation-type) блокує data-corruption-state.
 * 3. `taxId-формат відповідає type` — Sprint 7 §SP-4 RNOKPP+checksum для
 *    individual/fop, ЄДРПОУ 8-digit без checksum для tov/organization.
 * 4. `isVatPayer === true ⇒ taxationSystem ∈ VAT_ALLOWED_TAXATION_SYSTEMS`
 *    (Sprint 3 рішення C1) — ПДВ legitимно платять лише на спрощеній-3 чи
 *    загальній. Активний лише коли обидва поля не-null (для individual /
 *    organization тривіально-true: short-circuit на null).
 *
 * Жоден з цих refine-ів Mongoose comb-валідатором не виразить — тримаємо у
 * Zod як single source of truth.
 */

const NAME_LIMIT = effectiveLimit('receiverName');
const PURPOSE_LIMIT = effectiveLimit('purpose');

export const businessTypeSchema = z.enum(BUSINESS_TYPES);
export const bankCodeSchema = z.enum(MVP_BANKS);
export const taxationSystemSchema = z.enum(TAXATION_SYSTEMS);

/**
 * Slug формату DNS-style з case-preserved display (Sprint 3 рішення E1).
 *
 * Лише букви/цифри і дефіси-розділювачі; обидва регістри дозволені (`IvanEnko`
 * валідний). Без дефіса на краях, без послідовних дефісів. Min 3, max 63.
 *
 * **Case-insensitive uniqueness/lookup живе на `slugLower`**, не тут — entity
 * містить **обидва поля**, інваріант `slugLower === slug.toLowerCase()`
 * перевіряється refine-ом нижче (захист від БД-документа з drift-ом).
 *
 * Reserved-список і unique-перевірка — поза цією схемою (slug-генератор).
 */
export const businessSlugSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_TOO_SHORT' })
    .max(63, { message: 'INVALID_SLUG_TOO_LONG' })
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, {
        message: 'INVALID_SLUG_FORMAT',
    });

/**
 * Lowercase-нормалізована форма `slug`. Mongoose unique-index живе саме на цьому
 * полі — забезпечує case-insensitive uniqueness (`IvanEnko` блокує `ivanenko`,
 * `IVANENKO`). Public-lookup нормалізує URL до lowercase і шукає по `slugLower`.
 */
export const businessSlugLowerSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_LOWER_TOO_SHORT' })
    .max(63, { message: 'INVALID_SLUG_LOWER_TOO_LONG' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'INVALID_SLUG_LOWER_FORMAT',
    });

/**
 * Sub-схема реквізитів. Sprint 7 §SP-4 — type-binding (10-digit для individual/
 * fop vs 8-digit для tov/organization) живе на parent-рівні `BusinessSchema`
 * (read-side refine `TAX_ID_FORMAT_MISMATCH_TYPE`) і на write-DTO рівні
 * `CreateBusinessSchema` per-variant requisites-shape. На рівні БД
 * `BusinessRequisites.taxId: string` — без розгалуження за форматом.
 *
 * **`taxId: payerTaxIdZod`, не `z.string()` plain** — defense-in-depth для
 * read-side і `UpdateBusinessSchema` (partial PATCH без `type`-context-у).
 * Sub-schema reject-ить structurally garbage (`'abc'`, 5/9/11-digit, …)
 * незалежно від parent-context-у. Parent-refine `TAX_ID_FORMAT_MISMATCH_TYPE`
 * спрацьовує лише на pass object-shape: за слабкої sub-схеми невалідний taxId
 * у PATCH прослизав би до service-layer-у, де type-binding-перевірка живе
 * як cross-check, але structural перевірка має зайти раніше.
 *
 * Sub-schema приймає union {RNOKPP, ЄДРПОУ}; type-binding дискримінує всередині
 * (read-refine + service cross-check для PATCH; create-DTO discriminated union
 * вибирає konkrétний валідатор per-variant).
 */
export const BusinessRequisitesSchema = z.object({
    iban: ibanZod,
    taxId: payerTaxIdZod,
});

export const businessNameSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_NAME_REQUIRED' })
    .max(NAME_LIMIT.chars, { message: 'INVALID_NAME_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, NAME_LIMIT.bytes), {
        message: 'INVALID_NAME_BYTE_LENGTH',
    });

export const businessPaymentPurposeTemplateSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_PURPOSE_REQUIRED' })
    .max(PURPOSE_LIMIT.chars, { message: 'INVALID_PURPOSE_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, PURPOSE_LIMIT.bytes), {
        message: 'INVALID_PURPOSE_BYTE_LENGTH',
    });

export const BusinessSchema = z
    .object({
        id: objectIdSchema,
        type: businessTypeSchema,
        ownerId: objectIdSchema.nullable(),
        managers: z.array(objectIdSchema),
        slug: businessSlugSchema,
        slugLower: businessSlugLowerSchema,
        name: businessNameSchema,
        requisites: BusinessRequisitesSchema,
        /**
         * Sprint 7 §SP-3 — nullable. `null` для типів, що не мають оподаткування
         * (`individual`, `organization`); non-null для `fop`/`tov` (enforced
         * через iff-refine `TAXATION_FIELDS_MISMATCH_TYPE` нижче).
         */
        taxationSystem: taxationSystemSchema.nullable(),
        /**
         * Sprint 7 §SP-3 — nullable, semantics symmetric to `taxationSystem`.
         */
        isVatPayer: z.boolean().nullable(),
        paymentPurposeTemplate: businessPaymentPurposeTemplateSchema,
        acceptedBanks: z.array(bankCodeSchema),
        seoIndexEnabled: z.boolean(),
        /**
         * Sprint 4 §4.1 — дефолтний slug-preset, що буде попередньо обраний у
         * формі створення інвойсу для цього бізнесу. `null = "не визначено"`
         * → форма стартує з global system fallback `simple` (Sprint 4 §4.5
         * read-spilling default).
         *
         * **Default `null`, не `'simple'`**: бізнес без явного налаштування
         * семантично "не вказав уподобання"; UI робить fallback окремо. Це
         * дозволяє відрізнити "ФОП явно обрав simple" від "ФОП ще не торкався
         * налаштування" — потрібно для майбутнього onboarding-prompt-у
         * у Sprint 6 (Paid вільний вибір).
         *
         * **Existing-doc compatibility:** `.default(null)` на Zod-парсингу
         * страхує від retroactive missing-field-on-load для документів,
         * створених до Sprint 4 (Mongoose default спрацьовує лише при create,
         * не на read existing-doc).
         */
        invoiceSlugPresetDefault: slugPresetSchema.nullable().default(null),
        deletedAt: z.coerce.date().nullable(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    })
    .refine((b) => b.ownerId !== null || b.managers.length >= 1, {
        message: 'OWNERLESS_BUSINESS_REQUIRES_MANAGER',
        path: ['managers'],
    })
    .refine((b) => b.slugLower === b.slug.toLowerCase(), {
        message: 'SLUG_LOWER_MISMATCH',
        path: ['slugLower'],
    })
    .refine(
        // Sprint 7 §SP-3 — strict iff. Слабка форма `requiresTaxation(type)
        // === (both-non-null)` пропускає mixed-state (одне garbage, інше null)
        // на не-taxation-types, бо обидві сторони стають `false === false`.
        // Сильніший інваріант: для taxation-types обидва non-null; для
        // не-taxation-types обидва null. Будь-яке garbage поле блокується
        // незалежно від другого.
        (b) =>
            requiresTaxation(b.type)
                ? b.taxationSystem !== null && b.isVatPayer !== null
                : b.taxationSystem === null && b.isVatPayer === null,
        {
            message: 'TAXATION_FIELDS_MISMATCH_TYPE',
            path: ['taxationSystem'],
        }
    )
    .refine(
        // Sprint 7 §SP-4 — taxId-формат за `type`. Path `requisites.taxId` —
        // щоб RHF inline-помилка з'явилася саме під полем введення.
        (b) => isTaxIdValidForType(b.type, b.requisites.taxId),
        {
            message: 'TAX_ID_FORMAT_MISMATCH_TYPE',
            path: ['requisites', 'taxId'],
        }
    )
    .refine(
        // Sprint 3 C1 — VAT × taxationSystem coupled-rule. Sprint 7 модифікація:
        // активний лише коли обидва поля non-null. Для individual / organization
        // вони обидва null → short-circuit тривіально-true (зловлено iff-refine
        // вище).
        (b) =>
            b.taxationSystem === null ||
            b.isVatPayer === null ||
            !b.isVatPayer ||
            isVatAllowedTaxationSystem(b.taxationSystem),
        {
            message: 'INVALID_VAT_FOR_TAXATION_SYSTEM',
            path: ['isVatPayer'],
        }
    );

export type Business = z.infer<typeof BusinessSchema>;
export type BusinessRequisites = z.infer<typeof BusinessRequisitesSchema>;
