import { z } from 'zod';

import { businessBrandSchema } from './brand';
import { MVP_BANKS } from '../constants/banks';
import { BUSINESS_TYPES, requiresTaxation } from '../enums/business-type';
import {
    TAXATION_SYSTEMS,
    isTaxationAllowedForType,
    isVatAllowedTaxationSystem,
} from '../enums/taxation-system';
import { isWithinNbuCharset } from '../qr/charset';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';
import { isTaxIdValidForType, payerTaxIdZod } from '../validation/tax-id';

/**
 * Бізнес — юр-особа з унікальною публічною сторінкою (`pay.finly.com.ua/{slug}`).
 * Sprint 9 §SP-1 рефакторинг: IBAN переїхав на окрему сутність `Account`
 * (`packages/types/src/entities/account.ts`); Business зберігає тільки
 * юр-property платника (type, name, taxId, taxationSystem, isVatPayer,
 * paymentPurposeTemplate, slug, ownership).
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо, бо це write-side / runtime-time):
 * - Унікальність `slugLower` глобально — Mongoose unique index.
 * - Резервовані slug-и (`qr`, `api`, `host-pay`, …) — slug-генератор.
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
 *    individual/fop, ЄДРПОУ 8-digit без checksum для tov/organization. Sprint 9
 *    переніс `taxId` з `requisites.taxId` на top-level; refine path оновлений.
 * 4. `isVatPayer === true ⇒ taxationSystem ∈ VAT_ALLOWED_TAXATION_SYSTEMS`
 *    (Sprint 3 рішення C1) — ПДВ legitимно платять лише на спрощеній-3 чи
 *    загальній. Активний лише коли обидва поля не-null (для individual /
 *    organization тривіально-true: short-circuit на null).
 * 5. `taxationSystem ∈ ALLOWED_TAXATION_SYSTEMS_BY_TYPE[type]` —
 *    юр-обмеження за типом бізнесу. ПКУ розд. XIV гл. 1 закріплює групи 1
 *    і 2 єдиного податку виключно за ФОП; ТОВ можуть бути на групі 3 або
 *    загальній системі. Активний лише коли `requiresTaxation(type)` і
 *    `taxationSystem !== null` (інакше — короткозамкнутий iff-refine
 *    `TAXATION_FIELDS_MISMATCH_TYPE` спрацював би раніше).
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
 * NBU-charset refine — закриває інваріант "будь-який валідно збережений
 * Business може згенерувати валідний QR" (Sprint 2 §2.2). До Sprint 8 цей
 * валідатор жив internal-only у payload-builder-і; невалідний-для-NBU символ
 * (emoji ☕, multi-line LF/CR, Unicode-блок без Win1251-mapping) проходив
 * write-валідацію → save success → render QR падав з 500 на public-сторінці
 * (`PayloadValidationError` → `AllExceptionsFilter` мапить як INTERNAL_ERROR,
 * бо це не HttpException). Refine на entity-level робить це 400
 * `VALIDATION_ERROR` на write-path для всіх consumer-ів (cabinet wizard,
 * cabinet edit, anon QR-preview).
 *
 * Окремий `INVALID_NAME_CHARSET` / `INVALID_PURPOSE_CHARSET` код, не reuse
 * `INVALID_*_BYTE_LENGTH` — error-mapping на frontend-і дає різні
 * UX-рекомендації: "коротша назва" vs "приберіть emoji/підкреслення/iconки".
 */
export const businessNameSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_NAME_REQUIRED' })
    .max(NAME_LIMIT.chars, { message: 'INVALID_NAME_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, NAME_LIMIT.bytes), {
        message: 'INVALID_NAME_BYTE_LENGTH',
    })
    .refine(isWithinNbuCharset, { message: 'INVALID_NAME_CHARSET' });

export const businessPaymentPurposeTemplateSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_PURPOSE_REQUIRED' })
    .max(PURPOSE_LIMIT.chars, { message: 'INVALID_PURPOSE_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, PURPOSE_LIMIT.bytes), {
        message: 'INVALID_PURPOSE_BYTE_LENGTH',
    })
    .refine(isWithinNbuCharset, { message: 'INVALID_PURPOSE_CHARSET' });

export const BusinessSchema = z
    .object({
        id: objectIdSchema,
        type: businessTypeSchema,
        ownerId: objectIdSchema.nullable(),
        managers: z.array(objectIdSchema),
        slug: businessSlugSchema,
        slugLower: businessSlugLowerSchema,
        name: businessNameSchema,
        /**
         * Sprint 10 §SP-11 — anti-duplicate-Business token для anon-claim-flow.
         * UUID v4, генерований frontend-side на CTA-click "Зберегти у кабінет".
         * Backend `BusinessesService.create` має partial-unique-compound-index
         * `(ownerId, claimIdempotencyKey)` з `partialFilterExpression:
         * { claimIdempotencyKey: { $type: 'string' } }` — повторний POST з
         * тим самим (userId, key) повертає existing Business replay-shape
         * замість дубльованого insert.
         *
         * **Optional у entity-shape**, бо cabinet-wizard-create НЕ передає
         * це поле (відсутнє у документі → не входить у partial-index → не
         * блокує множинні cabinet-create без anon-claim-context-у).
         */
        claimIdempotencyKey: z.string().uuid().optional(),
        /**
         * Sprint 9 §SP-1 — `taxId` як top-level поле (раніше `requisites.taxId`).
         * `requisites`-wrapper повністю прибраний разом з міграцією IBAN на
         * окрему сутність `Account`. Defense-in-depth structural-валідатор
         * `payerTaxIdZod` (union RNOKPP ∪ ЄДРПОУ) reject-ить garbage до того,
         * як parent-refine `TAX_ID_FORMAT_MISMATCH_TYPE` дістанеться до
         * type-binding-перевірки.
         */
        taxId: payerTaxIdZod,
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
        seoIndexEnabled: z.boolean(),
        deletedAt: z.coerce.date().nullable(),
        /**
         * Sprint 27 — денормалізований прапор «бізнес у активному Бренд-складі».
         * `null` — бренд-фічі (кастомний slug, логотип) вимкнені; timestamp —
         * бізнес прикріплений хоча б до одного активного Бренд-складу платника.
         * Web-гейтинг vanity-slug і логотипа читає саме цей прапор (per-business),
         * не рівень користувача.
         */
        brandedAt: z.coerce.date().nullable(),
        /**
         * Sprint 21 — кастомний брендинг отримувача (логотип у обидва QR + на
         * публічних pay-сторінках). Два слоти: `active` рендериться публічно
         * (лише коли рівень доступу не нижче brand), `pending` чекає оплати або
         * повернення доступу. `null` — бренду немає, скрізь показується Finly.
         * Контракт слотів — `@finly/types` `businessBrandSchema`.
         */
        brand: businessBrandSchema.nullable(),
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
        // Sprint 7 §SP-4 — taxId-формат за `type`. Sprint 9 path-оновлення:
        // `requisites.taxId` → top-level `taxId` після видалення requisites-
        // wrapper-у. Path вживається у RHF inline-помилці під полем введення.
        (b) => isTaxIdValidForType(b.type, b.taxId),
        {
            message: 'TAX_ID_FORMAT_MISMATCH_TYPE',
            path: ['taxId'],
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
    )
    .refine(
        // Юр-обмеження за типом: групи 1/2 єдиного податку — виключно для ФОП.
        // Активний лише коли `requiresTaxation(type)` і `taxationSystem !==
        // null`; інакше iff-refine `TAXATION_FIELDS_MISMATCH_TYPE` (вище) вже
        // забракував би документ як invalid stored state.
        (b) =>
            !requiresTaxation(b.type) ||
            b.taxationSystem === null ||
            isTaxationAllowedForType(b.type, b.taxationSystem),
        {
            message: 'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
            path: ['taxationSystem'],
        }
    );

export type Business = z.infer<typeof BusinessSchema>;
