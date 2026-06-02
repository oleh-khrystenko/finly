import { z } from 'zod';

import { BANK_LABEL, type BankCode, MVP_BANKS } from '../constants/banks';
import { slugPresetSchema } from '../enums/slug-preset';
import { isWithinNbuCharset } from '../qr/charset';
import { isWithinByteLimit } from '../qr/limits';
import { objectIdSchema } from '../validation/common';
import { ibanZod } from '../validation/iban';

/**
 * Account — банківський рахунок під бізнесом (Sprint 9 §SP-1).
 *
 * Розщеплення `Business`-сутності: до Sprint 9 IBAN жив на `Business.requisites`,
 * що плутало юр-особу і банківський рахунок (ФОП з 2 рахунками створював 2
 * "бізнеси" з однаковим ІПН). Account виносить рахунок у окрему сутність;
 * `Business` лишається з type/name/taxId/taxationSystem/isVatPayer.
 *
 * **Інваріанти, що Zod НЕ перевіряє** (свідомо, бо це write-side / DB-level):
 *  - Unique `(businessId, slug)` — Mongoose compound-unique index (§SP-10
 *    case-sensitive, без `slugLower`-поля за моделлю invoice-slug Sprint 4).
 *  - Unique `(businessId, iban)` — Mongoose compound-unique index (§SP-2:
 *    anti-duplicate IBAN під одним бізнесом). Cross-business duplicates
 *    дозволені (ФОП і ТОВ ділять рахунок).
 *  - `iban` immutable post-creation (§SP-2) — DTO-rule: `UpdateAccountSchema`
 *    не містить `iban`.
 *  - `bankCode === bankCodeFromIban(iban)` — write-time invariant, що ставиться
 *    у `AccountsService.create` один раз (§SP-9 stored derived value).
 *    Drift-протекція через IBAN immutability: stored bankCode не може
 *    розходитися з IBAN, бо IBAN не змінюється.
 *
 * **`bankCode: BankCode | null`** — `null` для нерозпізнаних МФО (дрібні
 * регіональні банки поза `BANK_MFO_MAP`). UI-rule §SP-9: на null bank-label-row
 * ховається повністю (не fallback на текст "Невідомий банк"). 4 UI-точки
 * консистентно: cabinet AccountsSection cards, cabinet BasicSection, public
 * list-card, public per-account heading.
 *
 * **`deletedAt` навмисно невикористане у Sprint 9** (mirror-pattern Business.
 * deletedAt): hard-delete всередині `withTransaction`, не soft-delete. Поле
 * залишається для forward-compat з потенційним soft-delete-pattern-ом
 * (Sprint 13+). Service-layer lookup-и НЕ додають `deletedAt: null`-фільтри.
 */

const NAME_CHAR_LIMIT = 60;
const NAME_BYTE_LIMIT = 120;

/**
 * Account display-name: 1-60 chars, NBU-charset. **Опціональний** —
 * `null`, якщо ФОП не ввів власну назву. Раніше backend матеріалізував
 * авто-рядок `"{BANK_LABEL} •{last4}"`, але він дублювався з bank-label/mask-
 * рядками у картці. Тепер відсутність назви = `null`, а display-лейбл
 * деривується на льоту через `deriveAccountLabel` (нижче). Сама `accountNameSchema`
 * валідовує лише введене значення (1-60, NBU-charset) — nullable вішається у
 * місцях використання (`AccountSchema.name`, public-view-схеми).
 *
 * **Чому 60 chars cap, не reuse `businessNameSchema` (140 chars):** Account.name
 * не пише у NBU payload (receiverName залишається `business.name`), а тільки
 * рендериться у cabinet-cards / public-list / per-account-heading. Лімітом 60
 * захищаємо card-layout від wrap-у. NBU-charset застосовуємо для consistency:
 * якщо ФОП захоче коли-небудь скопіювати account.name у business.name або в
 * paymentPurposeTemplate (через UI), значення вже сумісне з payload-charset-ом.
 *
 * **byte-limit 120** — консервативна верхня межа за тим самим принципом, що у
 * `effectiveLimit` (chars × 2 для cyrillic UTF-8 2 B/char).
 */
export const accountNameSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_ACCOUNT_NAME_REQUIRED' })
    .max(NAME_CHAR_LIMIT, { message: 'INVALID_ACCOUNT_NAME_CHAR_LENGTH' })
    .refine((v) => isWithinByteLimit(v, NAME_BYTE_LIMIT), {
        message: 'INVALID_ACCOUNT_NAME_BYTE_LENGTH',
    })
    .refine(isWithinNbuCharset, { message: 'INVALID_ACCOUNT_NAME_CHARSET' });

/**
 * Account-slug: рівно 8 chars `[A-Za-z0-9]`, case-sensitive (§SP-10).
 *
 * **Чому case-sensitive (модель invoice-slug Sprint 4 §SP-8, не business-slug
 * Sprint 3):** account-slug — system-generated random tail, ніколи не
 * вводиться вручну і не показується як vanity-target. 8-char A-Za-z0-9 простір
 * ~218 трлн комбінацій — астрономічно low шанс генерувати `abc12345` і
 * `Abc12345` обидва. Без `slugLower`-поля, без canonical-redirect.
 */
export const accountSlugSchema = z
    .string()
    .regex(/^[A-Za-z0-9]{8}$/, { message: 'INVALID_ACCOUNT_SLUG_FORMAT' });

/**
 * Zod-схема `BankCode` — reuse з business-домена (`MVP_BANKS`). Stored у
 * Account-документі як snapshot derived з МФО на момент create (§SP-9).
 */
const bankCodeSchema = z.enum(MVP_BANKS);

export const AccountSchema = z.object({
    id: objectIdSchema,
    businessId: objectIdSchema,
    iban: ibanZod,
    name: accountNameSchema.nullable(),
    slug: accountSlugSchema,
    /**
     * §SP-9 — stored derived value, не runtime-computed. Резолвиться через
     * `bankCodeFromIban(iban)` рівно один раз під час `AccountsService.create`
     * і фіксується у документі. На нерозпізнаному МФО (поза `BANK_MFO_MAP`) —
     * `null`; UI-rule ховає bank-label-row для null-values.
     */
    bankCode: bankCodeSchema.nullable(),
    /**
     * §SP-6 — per-account дефолт slug-preset для інвойсу. Семантика ідентична
     * попередньому полю на Business (Sprint 4 §4.1): `null` = "не визначено",
     * форма створення інвойсу fallback-ить на global system default `'simple'`.
     * Sprint 9 переносить власника поля з Business на Account (нумерація
     * інвойсів per-account).
     *
     * `.default(null)` страхує від retroactive missing-field-on-load для
     * документів, створених до Sprint 9 (Mongoose default спрацьовує лише
     * при create, не на read existing-doc; на Sprint 9 production-data немає,
     * але dev-environment-документи проходитимуть Zod-парсинг без падіння).
     */
    invoiceSlugPresetDefault: slugPresetSchema.nullable().default(null),
    deletedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

export type Account = z.infer<typeof AccountSchema>;
export type AccountBankCode = BankCode;

/**
 * Display-лейбл рахунку. Якщо є користувацька `name` — повертаємо її; інакше
 * деривуємо `"{BANK_LABEL} •{last4}"` (або `"Банк •{last4}"` на нерозпізнаному
 * банку). Єдине джерело однорядкового лейбла для toast-ів, confirm-діалогу та
 * placeholder-а edit-поля.
 *
 * Картки (cabinet + public-list) роблять власну дворядкову розкладку
 * (title + mask) на основі `name === null`, тому хелпер їм не потрібен —
 * він навмисно повертає рядок, а не структуру.
 */
export function deriveAccountLabel(params: {
    name: string | null;
    bankCode: BankCode | null;
    /** `•{last4}` — server-derived маска IBAN. */
    ibanMask: string;
}): string {
    if (params.name) return params.name;
    return params.bankCode !== null
        ? `${BANK_LABEL[params.bankCode]} ${params.ibanMask}`
        : `Банк ${params.ibanMask}`;
}
