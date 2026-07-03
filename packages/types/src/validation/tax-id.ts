import { z } from 'zod';

import type { BusinessType } from '../enums/business-type';

/**
 * Validators для "Коду одержувача" платіжного payload-у НБУ (постанова № 97,
 * додатки 3/4 §IV.10.5). Норматив дозволяє рівно дві довжини:
 *
 *  - **РНОКПП** (10 цифр) — фізособа / ФОП. Десята цифра — контрольна,
 *    обчислена з перших 9 за алгоритмом ДПС.
 *  - **ЄДРПОУ** (8 цифр) — юр.особа (ТОВ, ОСББ, благодійний фонд, …).
 *
 * Sprint 7 розширює реєстр з одного валідатора (`individualTaxIdZod`) на трійку:
 *  - `individualTaxIdZod` — без змін, лишається для callsite-ів, що знають
 *    про резидентську фізособу (Sprint 4 invoice-payee-snapshot, окремі
 *    cabinet-форми у режимі `type ∈ {individual, fop}`).
 *  - `legalEntityTaxIdZod` — нове, лише структурна перевірка `^\d{8}$` без
 *    ДКСУ-checksum (Sprint 7 §SP-2 rationale: 2-фазний алгоритм має edge-cases
 *    зі legacy-кодами, naive-implementation відсіче 5-10% валідних реальних
 *    ЄДРПОУ як false-negative; банк-додаток клієнта валідує реквізити при
 *    списанні. Tech-backlog ticket фіксує можливість додати checksum пізніше
 *    без breaking-change — додавання refine-у не ламає валідні документи).
 *  - `payerTaxIdZod` — union 10-цифрового РНОКПП ∪ 8-цифрового ЄДРПОУ;
 *    використовується там, де `type` отримувача невідомий statически, як-от у
 *    QR-payload-builder-і `PayloadInputSchema.receiverTaxId` (Sprint 7 §SP-10).
 */

const IPN_LENGTH = 10;
const IPN_PATTERN = /^\d{10}$/;
const IPN_WEIGHTS = [-1, 5, 7, 9, 4, 6, 10, 5, 7] as const;

function controlDigit(first9: string): number {
    let sum = 0;
    for (let i = 0; i < IPN_WEIGHTS.length; i++) {
        sum += (first9.charCodeAt(i) - 48) * IPN_WEIGHTS[i]!;
    }
    return (((sum % 11) + 11) % 11) % 10;
}

/**
 * РНОКПП (10 цифр + контрольна цифра за алгоритмом ДПС).
 *
 *   weights = [-1, 5, 7, 9, 4, 6, 10, 5, 7]
 *   control = (Σ digit_i × weight_i) mod 11 mod 10
 *
 * Зовнішня операція `mod 10` потрібна для випадку, коли `Σ mod 11 == 10`:
 * контрольна цифра не може бути двозначною, тому згортається у `0`.
 *
 * **Не реалізуємо** валідацію дати народження, закодованої у перших 5 цифрах
 * РНОКПП (це окреме business-rule, не частина checksum-перевірки).
 */
export function isValidIndividualTaxId(value: string): boolean {
    if (typeof value !== 'string') return false;
    if (value.length !== IPN_LENGTH) return false;
    if (!IPN_PATTERN.test(value)) return false;
    const expected = controlDigit(value.slice(0, 9));
    const actual = value.charCodeAt(9) - 48;
    return expected === actual;
}

/**
 * Надлишок довжини — окремий код: інпути дозволяють ввести більше за
 * нормативну довжину (видимий overflow чесніший за silent-обрізання
 * жорстким `maxLength`-ом, особливо при вставці), тож «забагато цифр» —
 * окремий user-facing failure-mode, і generic «у номері помилка» для
 * нього збивав би з пантелику.
 */
export const individualTaxIdZod = z.string().superRefine((value, ctx) => {
    if (value.length > IPN_LENGTH) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'INVALID_TAX_ID_TOO_LONG',
        });
        return;
    }
    if (!isValidIndividualTaxId(value)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'INVALID_TAX_ID',
        });
    }
});

export type IndividualTaxId = z.infer<typeof individualTaxIdZod>;

/**
 * ЄДРПОУ — 8 десяткових цифр, без checksum-перевірки на MVP (Sprint 7 §SP-2).
 *
 * **Чому без checksum:**
 *  1. ДКСУ-алгоритм має 2-фазну логіку (друге проходження з вагами 3..9 у разі
 *     залишку 10 на першому проході) і edge-cases (legacy-коди до 1992 для
 *     державних підприємств, нерезидентські коди, коди філій). Naive-impl
 *     відсіче 5-10% валідних реальних ЄДРПОУ як false-negative — для MVP, де
 *     ми відкриваємось на нові сегменти, заблокований ОСББ зі старим
 *     легітимним кодом — гірший провал, ніж пропущений typo.
 *  2. ЄДРПОУ — публічний реєстр (юрособу можна перевірити на opendatabot за
 *     5 секунд). РНОКПП-checksum мав сенс, бо РНОКПП — особистий код, його
 *     легко зробити з помилкою при ручному введенні; ЄДРПОУ зазвичай
 *     copy-paste з документа.
 *  3. Реальний контроль "чи код валідний" робить банк-додаток клієнта при
 *     списанні (Finly як "тупий генератор", модель А — `qr-decisions.md` §1.12).
 *
 * Додавання checksum пізніше — non-breaking change (нові документи можуть
 * мати помилку тільки коли writer ігнорує warning, що uncommon).
 */
const EDRPOU_PATTERN = /^\d{8}$/;
const EDRPOU_LENGTH = 8;

export const legalEntityTaxIdZod = z.string().superRefine((value, ctx) => {
    if (value.length > EDRPOU_LENGTH) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'INVALID_LEGAL_TAX_ID_TOO_LONG',
        });
        return;
    }
    if (!EDRPOU_PATTERN.test(value)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'INVALID_LEGAL_TAX_ID',
        });
    }
});

export type LegalEntityTaxId = z.infer<typeof legalEntityTaxIdZod>;

/**
 * Union-валідатор для "Коду одержувача" у NBU payload-builder-і (Sprint 7 §SP-10).
 *
 * Норматив НБУ дозволяє рівно 2 формати; будь-яке третє не існує у production
 * payment-flow. Union дає чисту semantic "приймаємо рівно один з двох", без
 * stale options.
 *
 * **Чому НЕ перейменовуємо `individualTaxIdZod` → `residentTaxIdZod`** і не
 * заміняємо його у downstream callsite-ах: name-стабільність публічного API
 * `@finly/types`. Sprint 4 invoice-payee-snapshot уже locked-in цей імпорт у
 * множині consumer-ів — перейменування ламає 4-5 callsite-ів без функціональної
 * різниці.
 *
 * **Issue-shape при провалі:** Zod union повідомляє issues від обох member-ів
 * (`INVALID_TAX_ID` від `individualTaxIdZod`, `INVALID_LEGAL_TAX_ID` від
 * `legalEntityTaxIdZod`). Consumer-сторона (`PayloadInputSchema`) це internal
 * validation; user-facing error-mapping живе на рівні cabinet-форм, які
 * вибирають konkrétно `individualTaxIdZod` або `legalEntityTaxIdZod` за
 * `taxIdLengthFor(type)` (Sprint 7 §7.7 / §7.8) — там issue-code однозначний.
 */
export const payerTaxIdZod = z.union([individualTaxIdZod, legalEntityTaxIdZod]);

export type PayerTaxId = z.infer<typeof payerTaxIdZod>;

/**
 * Sprint 7 §SP-4 — discriminator-helper для перевірки `taxId` у контексті
 * відомого `BusinessType`. Sprint 9 §SP-1 path-update: `taxId` тепер top-level
 * поле Business-документа (раніше `requisites.taxId`); semantics helper-а
 * незмінні.
 *
 * Single source of truth для трьох callsite-ів:
 *  1. `BusinessSchema` entity-refine (`TAX_ID_FORMAT_MISMATCH_TYPE`) — read-side
 *     інваріант, що збережений документ має taxId-формат, який матчить його
 *     `type`.
 *  2. `BusinessesService.update` cross-check — PATCH без `type`-context-у:
 *     service читає document-resident `type` і використовує цей helper, щоб
 *     обрати правильний валідатор для нового taxId-значення.
 *  3. Frontend `RequisitesSection` / `BusinessCreateForm` — inline-валідатор поля
 *     "Код одержувача" з `taxIdLengthFor(type)`-aware label / maxLength.
 *
 * **Семантика per `type`:**
 *  - `individual`, `fop` — РНОКПП, 10 цифр + checksum (повний `isValidIndividualTaxId`).
 *  - `tov`, `organization` — ЄДРПОУ, 8 цифр без checksum (Sprint 7 §SP-2).
 *
 * Discriminator-таблиця замість `if/else` дає compile-error при додаванні
 * нового `BusinessType` без оновлення мапінгу — той самий fail-fast pattern,
 * що `taxIdLengthFor`.
 */
const TAX_ID_VALIDATOR_BY_TYPE: Record<
    BusinessType,
    (value: string) => boolean
> = {
    individual: isValidIndividualTaxId,
    fop: isValidIndividualTaxId,
    tov: (value) => EDRPOU_PATTERN.test(value),
    organization: (value) => EDRPOU_PATTERN.test(value),
};

export const isTaxIdValidForType = (
    type: BusinessType,
    value: string
): boolean => TAX_ID_VALIDATOR_BY_TYPE[type](value);
