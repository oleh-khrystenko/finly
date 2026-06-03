import { z } from 'zod';

import { slugPresetSchema } from '../enums/slug-preset';
import { isWithinNbuCharset } from '../qr/charset';
import { effectiveLimit, isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';
import { ibanZod } from '../validation/iban';
import { payerTaxIdZod } from '../validation/tax-id';
import { businessNameSchema } from './business';

/**
 * Інвойс — одноразова платіжка під конкретний рахунок.
 *
 * Sprint 9 §SP-6 — інвойсна нумерація переїхала з business-namespace на
 * account-namespace. compound-unique `(accountId, slug)` замість `(businessId,
 * slug)`. `payeeSnapshot.iban` тепер береться з Account на момент create
 * (recipientName/taxId — далі з Business). `businessId` лишається як
 * denormalized field (set on insert з `account.businessId`, immutable) — для
 * прямого cascade-delete-business filter-у і analytical-запитів без зайвого
 * `$lookup` через accounts.
 *
 * **Що Zod-схема НЕ перевіряє** (свідомо):
 * - Унікальність `(accountId, slug)` — compound unique index у Mongoose.
 * - `validUntil >= now` (Sprint 4 review fix) — time-relative rule живе у
 *   `InvoicesService.create`/`.update`, бо Zod-refine отримав би "now" на
 *   момент Read існуючого invoice-а: stale документ із минулим `validUntil`
 *   валідно існує у БД (це expired-стан, видимий через
 *   `getInvoiceStatus`/server-side `isInvoiceExpired`). Тому write-side
 *   enforcement, не schema-level.
 * - Зв'язок `slugPreset === null` ⇔ slug-генератор не використовувався —
 *   аналітичне поле, без data-integrity invariant.
 * - `accountId.businessId === invoice.businessId` — структурна invariant
 *   ставиться у service-layer на create, далі immutable.
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
 * Slug інвойсу: vanity-string `[A-Za-z0-9]` + дефіси-роздільники, 3-128 chars
 * (Sprint 15 — дзеркало `businessSlugSchema`, ширша межа під довгі
 * preset-generated slug-и `2026-06-001-{tail}`).
 *
 * До Sprint 15 був `{людська-частина}-{8-char-tail}` immutable. Create все ще
 * генерує цю форму (валідна у новій граматиці); Sprint 15 робить slug
 * редаговуваним у кабінеті як vanity-string. Уникальність case-insensitive на
 * `slugLower` у межах `accountId` (Sprint 9 §SP-6 namespace), canonical-redirect
 * зі старого slug через `InvoiceSlugHistory`. Два account-и одного бізнесу
 * дозволено мати інвойс з однаковим slug-string-ом (per-account namespace).
 *
 * Reuse business-slug message-коди (`INVALID_SLUG_*`) — спільний UX-локалізатор.
 */
export const invoiceSlugSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_TOO_SHORT' })
    .max(128, { message: 'INVALID_SLUG_TOO_LONG' })
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, {
        message: 'INVALID_SLUG_FORMAT',
    });

/**
 * Lowercase-нормалізована форма invoice-slug. Mongoose compound-unique-index
 * `(accountId, slugLower)` живе на цьому полі — case-insensitive uniqueness у
 * межах рахунку. Public-lookup нормалізує URL-сегмент до lowercase.
 */
export const invoiceSlugLowerSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_LOWER_TOO_SHORT' })
    .max(128, { message: 'INVALID_SLUG_LOWER_TOO_LONG' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'INVALID_SLUG_LOWER_FORMAT',
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
 * **Sprint 9 рефакторинг:** `iban` тепер береться з Account на create
 * (раніше — з `Business.requisites.iban`). `recipientName` / `taxId` — далі
 * з Business (юр-property платника, не банківського рахунку). `paymentPurpose`
 * — як раніше, resolved через `effectiveInvoicePurpose`.
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
 * + live business reqs коли `payeeSnapshot === null`. Sprint 9 production-data
 * немає (`dropDatabase` вступний контракт) — legacy-fallback застосовується
 * лише у dev-environment-i.
 *
 * **`taxId: payerTaxIdZod` (Sprint 9 widening):** до Sprint 9 snapshot.taxId
 * приймав лише `individualTaxIdZod` (10-digit RNOKPP — Sprint 4 era з єдиним
 * `'fop'`-типом). Sprint 7 розширив enum business-types на 4 значення, серед
 * них `tov` / `organization` з 8-digit ЄДРПОУ; snapshot.taxId не оновили
 * синхронно — це залишилось як неявний bug-trap для tov-інвойсів. Sprint 9
 * вирівнює: `payerTaxIdZod` (union RNOKPP ∪ ЄДРПОУ) — той самий validator, що
 * `Business.taxId`. Drift-guard: майбутні зміни `Business.taxId` validator-а
 * автоматично propagate-уються у snapshot.
 *
 * **`recipientName` reuse `businessNameSchema`** (Sprint 8 fix): snapshot
 * kładeться у NBU payload через invoice flow, тому **мусить** мати ту саму
 * charset/length-валідацію, що live business name. Inline-дублікат drift-нув
 * від business після додавання NBU-charset refine: snapshot пропускав emoji
 * у NBU payload, викликаючи 500 на render. Циркулярна залежність
 * `business ↔ invoice` усунена через перенесення `slugPresetSchema` у
 * `enums/slug-preset.ts`.
 */
export const InvoicePayeeSnapshotSchema = z.object({
    recipientName: businessNameSchema,
    iban: ibanZod,
    taxId: payerTaxIdZod,
    paymentPurpose: invoicePaymentPurposeSchema,
});

export type InvoicePayeeSnapshot = z.infer<typeof InvoicePayeeSnapshotSchema>;

export const InvoiceSchema = z
    .object({
        id: objectIdSchema,
        /**
         * Sprint 9 §SP-6 — invoice nest-иться під Account (`accountId`
         * required). `businessId` залишається як denormalized field
         * (set on insert з `account.businessId`, immutable після — Invoice.
         * accountId immutable, Account.businessId immutable, отже
         * Invoice.businessId структурно invariant). Тримаємо для прямого
         * `Invoice.deleteMany({businessId})` у cascade-delete-business flow і
         * прямих аналітичних запитів "сума інвойсів по бізнесу" без додаткового
         * `$lookup` через accounts.
         */
        businessId: objectIdSchema,
        accountId: objectIdSchema,
        slug: invoiceSlugSchema,
        slugLower: invoiceSlugLowerSchema,
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
         * **Sprint 9 namespace-shift:** counter-index переходить з
         * `(businessId, slugCounterScope, slugCounter)` на `(accountId,
         * slugCounterScope, slugCounter)`. Privat і Mono account-и одного
         * бізнесу мають незалежні counter-namespace-и.
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
