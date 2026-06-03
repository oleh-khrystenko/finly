import { z } from 'zod';

import {
    businessNameSchema,
    businessSlugSchema,
    businessTypeSchema,
} from '../entities/business';
import {
    invoicePaymentPurposeSchema,
    invoiceSlugSchema,
} from '../entities/invoice';
import { slugPresetSchema } from '../enums/slug-preset';
import { PublicAccountListItemSchema } from './accounts';

/**
 * Sprint 4 §4.1 — write/read контракти для інвойсу.
 *
 * Single source of truth для API DTO (`createZodDto`) і frontend RHF-resolver-ів.
 * Інваріанти, що повторюються тут і в entity:
 *  - `amount === null && amountLocked === true` ⇒ `AMOUNT_LOCKED_REQUIRES_AMOUNT`.
 *    На write-DTO та entity-`InvoiceSchema` (Sprint 1) refine один; service-layer
 *    додатково валідує partial-update (читає БД для cross-field check).
 *  - `slug` / `slugPreset` / `businessId` — НЕ в write-схемах (генеруються
 *    backend-ом, immutable після створення).
 */

/**
 * Людська частина invoice-slug-у — input з форми створення (рівень 1 SP-1).
 * Lowercase + kebab-case, 1..60 chars, без leading/trailing dash, без послідовних
 * dash.
 *
 * **Окрема схема, не subset/refine `invoiceSlugSchema`** — UI live-валідація не
 * повинна вимагати від користувача знати про серверний 8-char tail. Backend
 * після генерації запише `humanPart + '-' + tail` і збереження проходить через
 * entity-`invoiceSlugSchema` — round-trip гарантує consistency.
 *
 * **Max 60 chars**: `humanPart + '-' + 8-char-tail` = 69 chars max — добре
 * вкладається в entity-cap 128.
 */
export const humanSlugPartSchema = z
    .string()
    .min(1, { message: 'INVALID_HUMAN_SLUG_PART_LENGTH' })
    .max(60, { message: 'INVALID_HUMAN_SLUG_PART_LENGTH' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'INVALID_HUMAN_SLUG_PART_FORMAT',
    });

/**
 * `slugInput` — discriminated union на полі `kind` (Sprint 4 SP-1).
 *
 * **Чому discriminated union, а не nullable string + nullable preset.**
 * TS-driven exhaustiveness у service: `switch (input.slugInput.kind)` дає
 * compile-error при додаванні нового kind у Sprint 6+. Альтернатива (nullable
 * string `slug` + nullable `slugPreset`) дозволяла б невалідний крос-стан
 * "обидва виставлені" або "обидва null" — silent class-of-bug.
 *
 *  - `explicit`: ФОП обирає human-частину; backend додає 8-char tail; `slugPreset` = `null`.
 *  - `preset`:   backend генерує згідно правил пресету + tail; `slugPreset` = preset.
 *  - `random`:   backend кидає лише 8-char tail; `slugPreset` = `null`.
 */
export const SlugInputSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('explicit'),
            humanPart: humanSlugPartSchema,
        })
        .strict(),
    z
        .object({
            kind: z.literal('preset'),
            preset: slugPresetSchema,
        })
        .strict(),
    z
        .object({
            kind: z.literal('random'),
        })
        .strict(),
]);

export type SlugInput = z.infer<typeof SlugInputSchema>;

/**
 * Грошове поле — копійки (int), nonnegative, з нормативним cap-ом 99_999_999_999
 * (= 999_999_999.99 грн, Sprint 2 `PayloadInputSchema.amountKopecks`).
 *
 * **`null` валідно** — режим qr-decisions §1.4 "вивіска у межах інвойсу":
 * клієнт сам вписує суму у банк-додатку. Sprint 1 entity coupled-refine блокує
 * (`null + amountLocked=true`) як суперечливу пару — окремий refine у write-DTO
 * нижче.
 */
const invoiceAmountKopecksSchema = z
    .number()
    .int()
    .nonnegative()
    .max(99_999_999_999, { message: 'INVALID_AMOUNT_OVERFLOW' })
    .nullable();

/**
 * `CreateInvoiceSchema` — повний payload з форми створення.
 *
 * **Чому `validUntil: z.coerce.date()`**: frontend RHF + JSON serialize дає ISO-
 * string; coerce безпечно парсить його у `Date`. Refine на `< createdAt` НЕ
 * робимо тут — це time-relative rule, що залежить від моменту запиту і живе на
 * service-layer (Sprint 1 schema-doc явно описує це обмеження).
 *
 * Coupled-refine `amount === null && amountLocked === true` — той самий, що в
 * entity `InvoiceSchema`. Frontend RHF + backend Zod-pipe дають користувачу
 * однакове повідомлення.
 */
export const CreateInvoiceSchema = z
    .object({
        amount: invoiceAmountKopecksSchema,
        amountLocked: z.boolean(),
        paymentPurpose: invoicePaymentPurposeSchema.nullable(),
        validUntil: z.coerce.date().nullable(),
        slugInput: SlugInputSchema,
    })
    .strict()
    .refine((data) => !(data.amount === null && data.amountLocked === true), {
        message: 'AMOUNT_LOCKED_REQUIRES_AMOUNT',
        path: ['amountLocked'],
    });

export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceSchema>;

/**
 * `UpdateInvoiceSchema` — partial по edit-allowed підмножині.
 *
 * **`slug` editable (Sprint 15)** — vanity-string; backend детектить rename,
 * пише старе значення в `InvoiceSlugHistory` (308-redirect + anti-squatting у
 * межах рахунку) і оновлює `slug + slugLower`. Колізія → `SLUG_TAKEN`.
 * `slugPreset` / `slugCounter*` лишаються недоторкані (Q3): пресет-нумерація —
 * історичний слід, лічильник монотонний незалежно від manual rename.
 *
 * **`slugPreset`/`businessId` навмисно виключено**: `slugPreset` — analytics-поле
 * "який пресет згенерував", post-factum зміна безглузда; `businessId` —
 * структурна прив'язка, не редагується.
 *
 * **`.strict()`**: невідомі ключі (`slugPreset`, `businessId`, `createdAt`, …)
 * — ZodValidationPipe → 400 `VALIDATION_ERROR`. Service не дублює перевірку:
 * TypeScript `UpdateInvoiceRequest` просто не містить цих ключів.
 *
 * **Coupled-refine** активується лише коли клієнт передав ОБИДВА поля у одному
 * PATCH — щоб inline-edit `amountLocked` без `amount` не падав з помилкою
 * (frontend читає поточний `amount` з view-state і відправляє тільки змінене
 * поле, refine не може перевірити пару). Cross-field check для `amountLocked`
 * без поточного `amount` живе у `InvoicesService.update` (читає documentний
 * `amount`, перевіряє пару при save) — це поза write-DTO Zod, бо вимагає DB-
 * доступу.
 */
export const UpdateInvoiceSchema = z
    .object({
        amount: invoiceAmountKopecksSchema,
        amountLocked: z.boolean(),
        paymentPurpose: invoicePaymentPurposeSchema.nullable(),
        validUntil: z.coerce.date().nullable(),
        slug: invoiceSlugSchema,
    })
    .partial()
    .strict()
    .refine(
        (data) =>
            data.amount === undefined ||
            data.amountLocked === undefined ||
            !(data.amount === null && data.amountLocked === true),
        {
            message: 'AMOUNT_LOCKED_REQUIRES_AMOUNT',
            path: ['amountLocked'],
        }
    );

export type UpdateInvoiceRequest = z.infer<typeof UpdateInvoiceSchema>;

/**
 * `PublicInvoiceSchema` — view-схема public endpoint
 * (`GET /businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`).
 *
 * **Whitelist 8 полів** (Sprint 4 §"Скоуп.Shared" + Sprint 9 §4.7 розширення):
 *  - 4 invoice-fields: `amount`, `amountLocked`, `paymentPurpose`, `validUntil`.
 *  - `slug` — invoice-slug.
 *  - `business` — nested view: `type`, `name`, `slug` (без `seoIndexEnabled` —
 *    інвойси завжди `noindex`, hardcoded на frontend).
 *  - **`account` — nested view (Sprint 9 §SP-6 розширення):** `slug`, `name`,
 *    `bankCode`, `ibanMask`. Клієнт бачить через який рахунок іде платіж +
 *    4-цифровий IBAN-tail для disambiguation. Reuse
 *    `PublicAccountListItemSchema` напряму — той самий whitelist, що на
 *    business-root-list-view (DRY-інваріант: account-shape consistent across
 *    public endpoints).
 *  - `nbuLinks` — pre-built NBU payload-link URLs (primary + legacy);
 *    **`null` коли invoice expired** (`validUntil < now`) — server-side
 *    block оплати по простроченому рахунку (review fix). Поки backend не
 *    віддає payment-vector, client рендерить heading + "Прострочено"-banner.
 *    QR endpoints у такому стані повертають 410 Gone — defense-in-depth.
 *
 * **`paymentPurpose: string` (NOT nullable у public-view)** — Sprint 4 §4.7:
 * клієнт має бачити "Призначення: ..." у sub-info-блоці перед оплатою.
 * Inheritance-rule (`invoice.paymentPurpose === null` → fallback на
 * `business.paymentPurposeTemplate`) backend resolve-ить на serialize-step
 * через `effectiveInvoicePurpose`. Frontend public-view не знає про
 * inheritance — це impl-detail backend-у; client отримує ефективний рядок,
 * що співпадає з `nbuLinks` payload-purpose. Cabinet preview-toggle
 * рендерить через цю ж public-view-шему — тож ФОП теж бачить resolved-string.
 *
 * **Реквізити (IBAN, ІПН) знову не у JSON-полях** — leak-vector тільки через
 * `nbuLinks` Base64URL payload (той самий інваріант що Sprint 3
 * `PublicBusinessSchema`). `account.ibanMask` (`•{last4}`) — НЕ leak,
 * 5-символьний disambiguator з якого неможливо відновити повний IBAN.
 */
export const PublicInvoiceSchema = z.object({
    amount: invoiceAmountKopecksSchema,
    amountLocked: z.boolean(),
    paymentPurpose: invoicePaymentPurposeSchema,
    validUntil: z.coerce.date().nullable(),
    slug: invoiceSlugSchema,
    business: z.object({
        type: businessTypeSchema,
        name: businessNameSchema,
        slug: businessSlugSchema,
    }),
    account: PublicAccountListItemSchema,
    nbuLinks: z
        .object({
            primary: z.string().url(),
            legacy: z.string().url(),
        })
        .nullable(),
});

export type PublicInvoiceView = z.infer<typeof PublicInvoiceSchema>;
