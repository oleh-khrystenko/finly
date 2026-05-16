import { z } from 'zod';

import {
    AccountSchema,
    accountNameSchema,
    accountSlugSchema,
} from '../entities/account';
import {
    bankCodeSchema,
    businessNameSchema,
    businessSlugSchema,
    businessTypeSchema,
} from '../entities/business';
import { slugPresetSchema } from '../enums/slug-preset';
import { ibanZod } from '../validation/iban';

/**
 * Sprint 9 §SP-1 + §SP-2 — write/read контракти для Account.
 *
 * Single source of truth для API DTO (`createZodDto`) і frontend RHF-resolver-ів.
 * Все, що генерується БД або сервісом, або з immutable-обмеженням, навмисно
 * відсутнє у write-схемах:
 *  - `id`, `createdAt`, `updatedAt`, `deletedAt` — генерує БД.
 *  - `slug` — генерує `AccountSlugGeneratorService` (8-char A-Za-z0-9 random tail,
 *    §SP-10 case-sensitive). UI ніколи не вводить.
 *  - `businessId` — резолвить service з route-param `:slug` + `BusinessAccessGuard`.
 *  - `iban` — приймається ТІЛЬКИ на create (§SP-2 immutable post-creation);
 *    UpdateAccountSchema свідомо не містить.
 *  - `bankCode` — write-time derived з IBAN через `bankCodeFromIban(iban)`
 *    (§SP-9 stored value). Клієнт не передає.
 */

/**
 * `ibanMask` — `•` + last 4 digits IBAN-у (наприклад, `"•6001"`). Server-derived
 * disambiguator для UI: дві Privat-картки одного ФОП відрізняються `•2580` vs
 * `•6001`. **Не leak-ає сам IBAN** — це 5-символьний рядок, з якого неможливо
 * відновити повний 29-символьний UA IBAN.
 *
 * Pattern `^•\d{4}$` — UA IBAN завжди закінчується цифрами (формат `UA<27 digits>`),
 * тому last4 — гарантовано `\d{4}`. Bullet U+2022 жорстко фіксований.
 */
const ibanMaskSchema = z
    .string()
    .regex(/^•\d{4}$/, { message: 'INVALID_IBAN_MASK_FORMAT' });

/**
 * `CreateAccountSchema` — payload з форми створення рахунку.
 *
 * **`name: optional`** — backend auto-generate `"{BANK_LABEL[bankCode]} •{last4}"`
 * якщо клієнт не передав (А4 auto-default-policy). UI у формі показує placeholder
 * "за замовчуванням буде підтягнуто з банку" і дозволяє опціональний override.
 *
 * **`.strict()`** — невідомі ключі (`slug`, `bankCode`, `businessId`,
 * `invoiceSlugPresetDefault`, …) reject-аться ZodValidationPipe → 400
 * `VALIDATION_ERROR`. Per-field invariants:
 *  - `slug` — не приймається на create (auto-generated server-side).
 *  - `bankCode` — не приймається (derived з IBAN).
 *  - `invoiceSlugPresetDefault` — Sprint 9 design: створюється з default `null`;
 *    редагується через PATCH окремо. Без UI-перевантаження create-форми.
 */
export const CreateAccountSchema = z
    .object({
        iban: ibanZod,
        name: accountNameSchema.optional(),
    })
    .strict();

export type CreateAccountRequest = z.infer<typeof CreateAccountSchema>;

/**
 * `UpdateAccountSchema` — partial по edit-allowed підмножині.
 *
 * **Editable: `name`, `invoiceSlugPresetDefault`** — обидва обираються ФОП.
 *
 * **Immutable: `iban`, `slug`, `businessId`, `bankCode`** — навмисно відсутні
 * у shape. `.strict()` reject-ить будь-яку спробу їх передати.
 *
 * **Чому iban immutable (§SP-2):** dual-rationale — payeeSnapshot на існуючих
 * інвойсах frozen на момент create (Sprint 4 review fix), тому зміна iban
 * не лікувала б історичні рахунки; додатково, bankCode stored derived (§SP-9)
 * перестав би співпадати з IBAN-документом. Натомість — delete + create новий.
 *
 * **Чому invoiceSlugPresetDefault editable окремим PATCH-ом**: Sprint 9 design
 * виносить це поле з create-форми (UI не перевантажуємо initial flow), але
 * пост-create ФОП може налаштувати default-пресет на cabinet-сторінці account.
 */
export const UpdateAccountSchema = z
    .object({
        name: accountNameSchema,
        invoiceSlugPresetDefault: slugPresetSchema.nullable(),
    })
    .partial()
    .strict();

export type UpdateAccountRequest = z.infer<typeof UpdateAccountSchema>;

/**
 * `PublicAccountListItemSchema` — whitelist for `pay.finly.com.ua/{businessSlug}`
 * root-page list (2+ Account варіант) і nested `accounts: []` у
 * `PublicBusinessSchema`. 4 поля.
 *
 * **Whitelist invariant (Sprint 9 §SP-1):** реквізити (IBAN, ІПН) не віддаються
 * у JSON напряму. `ibanMask` (`•{last4}`) — лише disambiguator, не leak-vector.
 * Реквізити присутні тільки через `nbuLinks` Base64URL payload на per-account-
 * page (той самий vector, що QR PNG).
 */
export const PublicAccountListItemSchema = z.object({
    slug: accountSlugSchema,
    name: accountNameSchema,
    bankCode: bankCodeSchema.nullable(),
    ibanMask: ibanMaskSchema,
});

export type PublicAccountListItem = z.infer<typeof PublicAccountListItemSchema>;

/**
 * `PublicAccountViewSchema` — view для `pay.finly.com.ua/{businessSlug}/{accountSlug}`
 * per-account вивіски. Whitelist 6 полів + nested `business` view + `nbuLinks`.
 *
 * **`ibanMask` обовʼязковий** як server-derived disambiguator для heading-
 * parenthetical (§SP-9): на `bankCode === null` heading рендерить `(•{last4})`,
 * на non-null — `({BANK_LABEL[bankCode]} •{last4})`. last4-postfix unconditional;
 * BANK_LABEL-prefix drop-ається при null-bankCode.
 *
 * **Nested `business` view** — inline-shape, бо `PublicBusinessSchema` у Sprint 9
 * рефакторингу містить `accounts: []` (рекурсивний reference був би циклом).
 * 5 полів узгоджених із cabinet `BasicSection` read-mode (Sprint 7 §SP-5
 * heading тип-нейтральний; `type` зарезервовано для aria-label / SEO).
 */
export const PublicAccountViewSchema = z.object({
    slug: accountSlugSchema,
    name: accountNameSchema,
    bankCode: bankCodeSchema.nullable(),
    ibanMask: ibanMaskSchema,
    business: z.object({
        type: businessTypeSchema,
        name: businessNameSchema,
        slug: businessSlugSchema,
        acceptedBanks: z.array(bankCodeSchema),
        seoIndexEnabled: z.boolean(),
    }),
    nbuLinks: z.object({
        primary: z.string().url(),
        legacy: z.string().url(),
    }),
});

export type PublicAccountView = z.infer<typeof PublicAccountViewSchema>;

/**
 * `AccountWithCountsSchema` — cabinet-only read-shape для `AccountsService.getBySlug`
 * і `getByBusinessId({ withInvoicesCount: true })` per-item.
 *
 * `invoicesCount` — derived counter (real-time `Invoice.countDocuments({accountId})`
 * per-request). Не stored field — drift-immune by design.
 *
 * Frontend конусм: `DangerSection` account-page + per-card AccountsSection
 * pre-check на `> 0 → toast.error(ACCOUNT_HAS_INVOICES)` без network-call-у
 * (§SP-3 two-line-of-defense; race-protection — backend `withTransaction`).
 */
export const AccountWithCountsSchema = AccountSchema.extend({
    invoicesCount: z.number().int().nonnegative(),
});

export type AccountWithCounts = z.infer<typeof AccountWithCountsSchema>;
