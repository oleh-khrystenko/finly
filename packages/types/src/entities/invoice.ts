import { z } from 'zod';

import { SLUG_PRESETS } from '../enums/slug-preset';
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
    .min(8)
    .max(128)
    .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[A-Za-z0-9]{8}$/, {
        message: 'INVALID_SLUG_FORMAT',
    });

export const InvoiceSchema = z
    .object({
        id: objectIdSchema,
        businessId: objectIdSchema,
        slug: invoiceSlugSchema,
        amount: z.number().int().nonnegative().nullable(),
        amountLocked: z.boolean(),
        paymentPurpose: z.string().trim().min(1).max(420).nullable(),
        validUntil: z.coerce.date().nullable(),
        slugPreset: slugPresetSchema.nullable(),
        deletedAt: z.coerce.date().nullable(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    })
    .refine((i) => !(i.amount === null && i.amountLocked === true), {
        message: 'AMOUNT_LOCKED_REQUIRES_AMOUNT',
        path: ['amountLocked'],
    });

export type Invoice = z.infer<typeof InvoiceSchema>;
