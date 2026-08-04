import { z } from 'zod';

import { BANK_LABEL, type BankCode, MVP_BANKS } from '../constants/banks';
import { businessPaymentPurposeTemplateSchema } from './business';
import { autoSlugModeSchema } from '../enums/slug-preset';
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
 *  - Unique `(businessId, slugLower)` — Mongoose compound-unique index
 *    (Sprint 15: case-insensitive uniqueness у межах бізнесу, дзеркало
 *    business-slug Sprint 3). `slug` редаговуваний vanity-string post-creation.
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
 * Account-slug: vanity-string `[A-Za-z0-9]` + дефіси-роздільники, 3-63 chars
 * (Sprint 15 — дзеркало `businessSlugSchema`).
 *
 * До Sprint 15 був рівно 8-char system-generated random tail (immutable). Тепер
 * редаговуваний у кабінеті: ФОП дає рахунку зрозуміле посилання (`mono-cafe`).
 * Create все ще авто-генерує 8-char tail (валідний у цій граматиці) — vanity-edit
 * опціональний post-create. Uniqueness case-insensitive на `slugLower` у межах
 * бізнесу; canonical-redirect зі старого slug через `AccountSlugHistory`.
 *
 * Reuse business-slug message-коди (`INVALID_SLUG_*`) — спільний UX-локалізатор.
 */
export const accountSlugSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_TOO_SHORT' })
    .max(63, { message: 'INVALID_SLUG_TOO_LONG' })
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, {
        message: 'INVALID_SLUG_FORMAT',
    });

/**
 * Lowercase-нормалізована форма account-slug. Mongoose compound-unique-index
 * `(businessId, slugLower)` живе на цьому полі — case-insensitive uniqueness у
 * межах бізнесу. Public-lookup нормалізує URL-сегмент до lowercase.
 */
export const accountSlugLowerSchema = z
    .string()
    .min(3, { message: 'INVALID_SLUG_LOWER_TOO_SHORT' })
    .max(63, { message: 'INVALID_SLUG_LOWER_TOO_LONG' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'INVALID_SLUG_LOWER_FORMAT',
    });

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
    slugLower: accountSlugLowerSchema,
    /**
     * Sprint 29 — чи slug вручну кастомізований (красивий). Кабінет читає для
     * допуску реквізитів у каталог. `.default(false)` страхує read.
     */
    slugCustomized: z.boolean().default(false),
    /**
     * §SP-9 — stored derived value, не runtime-computed. Резолвиться через
     * `bankCodeFromIban(iban)` рівно один раз під час `AccountsService.create`
     * і фіксується у документі. На нерозпізнаному МФО (поза `BANK_MFO_MAP`) —
     * `null`; UI-rule ховає bank-label-row для null-values.
     */
    bankCode: bankCodeSchema.nullable(),
    /**
     * §SP-6 — per-account «домашній формат» нумерації нових рахунків. `null` =
     * "не визначено", форма створення fallback-ить на global system default
     * `'simple'`. Тип розширено з 4 пресетів до `AutoSlugMode` (+`random`):
     * випадковий код теж може бути запам'ятаним дефолтом і відтвореним при
     * перевипуску посилання; `explicit` лишається поза дефолтом (ручний текст
     * не зберігається).
     *
     * `.default(null)` страхує від retroactive missing-field-on-load для
     * документів, створених до Sprint 9 (Mongoose default спрацьовує лише
     * при create, не на read existing-doc; на Sprint 9 production-data немає,
     * але dev-environment-документи проходитимуть Zod-парсинг без падіння).
     */
    invoiceSlugPresetDefault: autoSlugModeSchema.nullable().default(null),
    /**
     * Sprint 29 — per-account override призначення платежу. `null` = успадкувати
     * `business.paymentPurposeTemplate` (точна семантика `Invoice.paymentPurpose`,
     * лише на рівень вище). Потрібно, бо один отримувач легітимно тримає рахунки
     * з РІЗНИМИ призначеннями: обласне ГУ ДПС має окремі реквізити під ЄСВ і під
     * військовий збір, і призначення розносить платіж — воно не може бути спільним
     * на весь отримувач.
     *
     * Маркери підстановки (`{taxId}`) тут дозволені рівно за тим самим правилом,
     * що на `Business.paymentPurposeTemplate`: лише коли батьківський отримувач
     * системний. Інваріант живе на write-DTO (кабінетні схеми беруть
     * `regularPaymentPurposeTemplateSchema`, адмінські — `system…`), бо Account
     * не бачить `isSystem` батька і виразити refine на entity-рівні не може.
     *
     * `.default(null)` страхує read документів, створених до Sprint 29.
     */
    paymentPurposeTemplate: businessPaymentPurposeTemplateSchema
        .nullable()
        .default(null),
    /**
     * Sprint 29 — чи ці реквізити видимі у публічному каталозі. Гранулярність
     * публічності: рахунок може бути прихований, навіть коли отримувач публічний.
     * `.default(false)` страхує read існуючих документів без поля.
     */
    catalogVisible: z.boolean().default(false),
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
