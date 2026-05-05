import { z } from 'zod';

import { SLUG_PRESETS } from '../enums/slug-preset';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';

/**
 * Інвойс — одноразова платіжка під конкретний бізнес.
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо):
 * - Унікальність `(businessId, slug)` — compound unique index у Block 3.
 * - `validUntil < createdAt` — це time-relative rule, який залежить від моменту
 *   запиту і живе на app-layer (write-side service).
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

export const slugPresetSchema = z.enum(SLUG_PRESETS);

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

export const invoicePaymentPurposeSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_PURPOSE_REQUIRED' })
    .max(PURPOSE_LIMIT.chars, { message: 'INVALID_PURPOSE_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, PURPOSE_LIMIT.bytes), {
        message: 'INVALID_PURPOSE_BYTE_LENGTH',
    });

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
