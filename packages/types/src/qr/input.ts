import { z } from 'zod';

import { ibanZod } from '../validation/iban';
import { payerTaxIdZod } from '../validation/tax-id';

/**
 * Допустимі значення поля «Функція» у форматі 003 (Додаток 4 §II.4.4 ст. 27):
 *   UCT — кредитовий переказ (стандарт);
 *   ICT — миттєвий кредитовий переказ;
 *   XCT — миттєвий АБО кредитовий (вибір клієнтом).
 *
 * Для 002 функція завжди UCT (Додаток 3 §II.4.4 ст. 19) — параметр ігнорується.
 */
export const PAYLOAD_FUNCTIONS_003 = ['UCT', 'ICT', 'XCT'] as const;
export type PayloadFunction003 = (typeof PAYLOAD_FUNCTIONS_003)[number];

/**
 * Категорія/ціль за класифікатором ISO 20022 (Додаток 4 §II.4.10 ст. 27):
 * формат `CCCC/PPPP` — два 4-літерні uppercase коди через slash.
 * Приклади з PDF: `SUPP/SUPP`, `MP2P/MP2B`, `OTHR/GDDS`.
 */
const categoryPurposeSchema = z.string().regex(/^[A-Z]{4}\/[A-Z]{4}$/, {
    message: 'INVALID_CATEGORY_PURPOSE',
});

/**
 * Bitmask заборони редагування полів (Додаток 4 §II.4.14 ст. 27): hex-число
 * 0..FFFF, рівно 4 hex-цифри (uppercase, без префіксу `0x`).
 *
 * **Bit-numbering у нормативі.** PDF каже "номер біта починаючи з наймолодшого",
 * але приклад FEFF з §II.4.14 однозначно фіксує: для поля 8 (Сума) у FEFF
 * нульовий саме bit-pos 8 (0-indexed), не bit-pos 7. Тобто mapping
 * **field N (1-indexed) → bit-pos N (0-indexed)**, з bit-pos 0 невикористовуваним
 * як reserved. Текст "наймолодший" у нормативі описує "молодший кінець маски"
 * не математично точно (там, де bit-pos нижчі); приклад є джерелом правди.
 *
 * Перевірка на прикладі: FEFF binary = 1111_1110_1111_1111 → bit-pos 8 = 0
 * (МSB-байт 0xFE, найнижчий його біт = 0). Поле 8 = сума → editable. ✓
 *
 * **Норматив-обовʼязково = 1**: поля 1–5 (службові BCD/версія/кодування/функція/
 * унікальний-ID), 11 (Reference), 14–15 (lock-self / dates) у 16-bit mask.
 * Поля 16-17 (issuedAt / signature) виходять за 16-bit — фізично завжди locked.
 *
 * Приклади з PDF: `FEFF` (заборонено все, крім поля 8 — сума), `FFFF` (все
 * заборонено).
 */
const FIELD_LOCK_MASK_REQUIRED_BITS =
    // Поля 1-5 → bit-pos 1-5 → 0x003E.
    0x003e |
    // Поле 11 (Reference) → bit-pos 11 → 0x0800.
    0x0800 |
    // Поля 14-15 (lock-self / validUntil) → bit-pos 14-15 → 0xC000.
    // Поля 16, 17 — поза 16-bit mask, тривіально locked.
    0xc000;

const fieldLockMaskSchema = z
    .string()
    .regex(/^[0-9A-F]{4}$/, { message: 'INVALID_FIELD_LOCK_MASK_FORMAT' })
    .refine(
        (value) =>
            (parseInt(value, 16) & FIELD_LOCK_MASK_REQUIRED_BITS) ===
            FIELD_LOCK_MASK_REQUIRED_BITS,
        { message: 'INVALID_FIELD_LOCK_MASK_REQUIRED_BITS' }
    );

/**
 * Дата/час у форматі `YYMMDDHHmmss` (Додаток 4 §II.4.15-16): рівно 12 цифр.
 * Семантично tz-відносний рядок без taймзонної інформації — норматив не уточнює.
 * Інтерпретуємо як локальний український час; перетворення з `Date` — на caller-і.
 */
const yymmddhhmmssSchema = z.string().regex(/^\d{12}$/, {
    message: 'INVALID_DATETIME_FORMAT',
});

/**
 * Спільний вхід обох builder-ів (002 і 003).
 *
 * Required-поля (обовʼязкові у обох версіях нормативу):
 *   receiverName, iban, receiverTaxId, amountKopecks, purpose.
 *
 * 003-only поля — `optional`. Builder 002 їх ігнорує. Builder 003 для кожного
 * не-вказаного поля підставляє свій дефолт (FUNCTION='UCT', CATEGORY='OTHR/GDDS')
 * або порожній рядок (для опціональних полів нормативу).
 *
 * **Грошові суми у копійках (int)**:
 *   - `null` — поле «Сума/валюта» порожнє → клієнт вводить суму в банк-додатку
 *     (Додатки 3 §II.4.8 ст. 19, 4 §II.4.8 ст. 27).
 *   - `0+` — задана сума у копійках. Builder конвертує у `UAH<сума>` за правилами
 *     нормативу (мінімізація — `UAH3` замість `UAH3.00`).
 *   - Max 99_999_999_999 копійок = 999_999_999.99 грн (нормативний максимум).
 */
export const PayloadInputSchema = z.object({
    receiverName: z.string().trim().min(1, { message: 'INVALID_RECEIVER_NAME' }),
    iban: ibanZod,
    /**
     * Sprint 7 §SP-10 — `payerTaxIdZod` (union RNOKPP-10 ∪ ЄДРПОУ-8) замість
     * `individualTaxIdZod`. Норматив НБУ постанови № 97, додатки 3/4 §IV.10.5
     * "Код одержувача" дозволяє рівно дві довжини: 10 цифр (РНОКПП — фізособа /
     * ФОП) АБО 8 цифр (ЄДРПОУ — юр.особа). Builder-и 002 / 003 кладуть значення
     * у payload без додаткової перевірки довжини — type-binding до конкретного
     * `BusinessType` живе на write-DTO рівні (`CreateBusinessSchema`
     * discriminated union per-variant) і у `BusinessesService.update` cross-
     * check (читає document-resident `type`). Тут — лише структурна перевірка
     * "10-digit з checksum АБО 8-digit без checksum", узгоджена з нормативом.
     *
     * **Чому не залишаємо два окремих optional**: норматив дозволяє рівно один
     * з двох форматів у конкретному QR; union дає чисту semantic, без stale
     * options.
     */
    receiverTaxId: payerTaxIdZod,
    amountKopecks: z
        .number()
        .int()
        .nonnegative()
        .max(99_999_999_999, { message: 'INVALID_AMOUNT_OVERFLOW' })
        .nullable(),
    purpose: z.string().trim().min(1, { message: 'INVALID_PURPOSE' }),

    // 003-only optional inputs (002 ignore).
    function: z.enum(PAYLOAD_FUNCTIONS_003).optional(),
    categoryPurpose: categoryPurposeSchema.optional(),
    reference: z.string().optional(),
    display: z.string().optional(),
    fieldLockMask: fieldLockMaskSchema.optional(),
    validUntil: yymmddhhmmssSchema.nullable().optional(),
    issuedAt: yymmddhhmmssSchema.optional(),
});

export type PayloadInput = z.infer<typeof PayloadInputSchema>;
