import { z } from 'zod';

import { slugPresetSchema } from '../enums/slug-preset';
import { isWithinNbuCharset } from '../qr/charset';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';
import { ibanZod } from '../validation/iban';
import { individualTaxIdZod } from '../validation/tax-id';
import { businessNameSchema } from './business';

/**
 * Інвойс — одноразова платіжка під конкретний бізнес.
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо):
 * - Унікальність `(businessId, slug)` — compound unique index у Block 3.
 * - `validUntil >= now` (Sprint 4 review fix) — time-relative rule живе у
 *   `InvoicesService.create`/`.update`, бо Zod-refine отримав би "now" на
 *   момент Read існуючого invoice-а: stale документ із минулим `validUntil`
 *   валідно існує у БД (це expired-стан, видимий через
 *   `getInvoiceStatus`/server-side `isInvoiceExpired`). Тому write-side
 *   enforcement, не schema-level.
 * - Зв'язок `slugPreset === null` ⇔ slug-генератор не використовувався —
 *   аналітичне поле, без data-integrity invariant.
 *
 * **Length-обмеження `paymentPurpose` derived-from-spec** через `effectiveLimit`
 * (Sprint 2 §2.2). Той самий MIN-по-версіях інваріант, що в `Business.name` /
 * `Business.paymentPurposeTemplate`: інвойс, валідний для save, гарантовано
 * рендеритиме валідний QR для будь-якої з `PAYLOAD_VERSIONS`.
 *
 * **Грошові суми зберігаються у копійках** (`integer`, не `float`). Pesos →
 * копійки на API boundary; UI формує `15.00 ₴` з копійок при рендері. Це
 * знімає floating-point bugs при додаванні / порівнянні і відповідає
 * стандартній практиці payment-систем (Stripe, банки).
 *
 * `amount === null` — режим "вивіска у межах інвойсу": клієнт сам вводить
 * суму (рідкісний кейс, але валідний). У такому стані `amountLocked: true`
 * семантично неможливий ("заборонити правити те, чого нема") і блокується
 * Zod-refinement'ом на рівні entity.
 */

const PURPOSE_LIMIT = effectiveLimit('purpose');

/**
 * Slug інвойсу: `{людська-частина}-{8-char-tail}` АБО просто `{8-char-tail}`.
 * Хвіст — alphanum **case-sensitive** (62 символи на позицію, ~218T комбінацій).
 * Людська частина — lowercase kebab-case (як у бізнесі).
 *
 * Унікальність — у межах одного `businessId` (compound index у Block 3),
 * не глобально.
 */
export const invoiceSlugSchema = z
    .string()
    .min(8, { message: 'INVALID_SLUG_TOO_SHORT' })
    .max(128, { message: 'INVALID_SLUG_TOO_LONG' })
    .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[A-Za-z0-9]{8}$/, {
        message: 'INVALID_SLUG_FORMAT',
    });

/**
 * Sprint 8 fix — `INVALID_PURPOSE_CHARSET` refine симетрично з
 * `businessPaymentPurposeTemplateSchema`. Без нього invoice-render QR падав
 * з 500 на public-сторінці (PayloadValidationError → INTERNAL_ERROR), якщо
 * cabinet-форма пропускала emoji / non-Win1251 символ. Source-of-truth тепер
 * Zod на write-path.
 */
export const invoicePaymentPurposeSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_PURPOSE_REQUIRED' })
    .max(PURPOSE_LIMIT.chars, { message: 'INVALID_PURPOSE_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, PURPOSE_LIMIT.bytes), {
        message: 'INVALID_PURPOSE_BYTE_LENGTH',
    })
    .refine(isWithinNbuCharset, { message: 'INVALID_PURPOSE_CHARSET' });

/**
 * Sprint 4 review fix — `payeeSnapshot` фрозить платіжні реквізити на момент
 * створення інвойсу. Public NBU/QR payload будується з цього snapshot-у, а
 * не з runtime-mutable Business.
 *
 * **Чому окремий subdoc.** Payment instruction — атомарна одиниця: усі
 * чотири поля разом утворюють "хто отримує + за що". Embedded subdoc
 * робить snapshot semantically-explicit (vs flat fields, де неясно, які
 * поля frozen, а які live).
 *
 * **`paymentPurpose: string` (non-nullable у snapshot)** — на create
 * `service` resolve-ить `dto.paymentPurpose ?? business.paymentPurposeTemplate`
 * у конкретний рядок. Раніше `null` → runtime-resolve через поточний
 * template → drift при редагуванні business-template. Тепер effective-purpose
 * заморожений на момент create.
 *
 * **`.nullable()` на entity-level** — для backwards-compat з legacy invoices,
 * створеними до Sprint 4 review fix. `payload-mapper` fallback-ить на
 * `effectiveInvoicePurpose(invoice.paymentPurpose, business.paymentPurposeTemplate)`
 * + live business reqs коли `payeeSnapshot === null`. Migration script
 * `2026-05-08-invoices-payee-snapshot.ts` backfill-ить snapshot для
 * existing invoices з current business state (best-effort на migration
 * boundary; всі post-deploy invoices мають snapshot з-під service-create).
 */
/**
 * Sprint 8 fix — `recipientName` тепер reuse `businessNameSchema` напряму
 * (раніше — inline `payeeNameSchema`-дублікат). Snapshot kładeться у NBU
 * payload через invoice flow, тому **мусить** мати ту саму charset/length-
 * валідацію, що live business name. Inline-дублікат drift-нув від business
 * після додавання NBU-charset refine: snapshot пропускав emoji у NBU payload,
 * викликаючи 500 на render. Reuse через single-source гарантує, що всі
 * майбутні зміни businessNameSchema автоматично propagat-ять у snapshot.
 *
 * Циркулярна залежність `business ↔ invoice` усунена через перенесення
 * `slugPresetSchema` у `enums/slug-preset.ts` — тепер `invoice.ts` може
 * імпортувати з `business.ts` без зворотного імпорту.
 */
export const InvoicePayeeSnapshotSchema = z.object({
    recipientName: businessNameSchema,
    iban: ibanZod,
    taxId: individualTaxIdZod,
    paymentPurpose: invoicePaymentPurposeSchema,
});

export type InvoicePayeeSnapshot = z.infer<typeof InvoicePayeeSnapshotSchema>;

export const InvoiceSchema = z
    .object({
        id: objectIdSchema,
        businessId: objectIdSchema,
        slug: invoiceSlugSchema,
        amount: z.number().int().nonnegative().nullable(),
        amountLocked: z.boolean(),
        paymentPurpose: invoicePaymentPurposeSchema.nullable(),
        validUntil: z.coerce.date().nullable(),
        slugPreset: slugPresetSchema.nullable(),
        payeeSnapshot: InvoicePayeeSnapshotSchema.nullable().default(null),
        /**
         * Sprint 4 §4.1 — counter-namespace string для preset-режимів з
         * лічильником ('simple' | YYYY | 'YYYY-MM'). `null` для inших
         * режимів. Парний з `slugCounter` (обидва non-null або обидва null);
         * compound-unique partial-index у Mongoose-схемі race-блокує
         * counter-collision на write-path.
         *
         * **`.default(null)` страхує** від retroactive missing-field-on-load
         * для документів, створених до Sprint 4 (Mongoose default спрацьовує
         * лише при create, не на read existing-doc).
         */
        slugCounterScope: z.string().nullable().default(null),
        slugCounter: z.number().int().positive().nullable().default(null),
        deletedAt: z.coerce.date().nullable(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    })
    .refine((i) => !(i.amount === null && i.amountLocked === true), {
        message: 'AMOUNT_LOCKED_REQUIRES_AMOUNT',
        path: ['amountLocked'],
    })
    .refine(
        (i) =>
            (i.slugCounterScope === null && i.slugCounter === null) ||
            (i.slugCounterScope !== null && i.slugCounter !== null),
        {
            message: 'SLUG_COUNTER_SCOPE_PAIR_INVARIANT',
            path: ['slugCounter'],
        }
    );

export type Invoice = z.infer<typeof InvoiceSchema>;
