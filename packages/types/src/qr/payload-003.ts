import {
    FIELD_LIMITS,
    ROW_TERMINATOR,
    assertField,
    assertNbuCharset,
    assertOverallSize,
    formatAmountCurrency,
    parseInput,
} from './_payload-internals';

/**
 * Builder-defaults для optional 003-полів.
 *
 * `FUNCTION_DEFAULT = 'UCT'` — звичайний кредитовий переказ. Norm-default,
 * 100% покриває MVP Finly Модель А (без трекінгу). ICT/XCT — для майбутньої
 * інтеграції з банками (Phase 1.5+).
 *
 * `CATEGORY_PURPOSE_DEFAULT = 'OTHR/GDDS'` — інше / товари. ФОП-кейси Finly у
 * MVP — переважно retail/services, не комунальні платежі (`SUPP/SUPP`) чи P2P
 * (`MP2P/MP2B`). Якщо у Sprint 3 ФОП зможе обрати свою категорію на бізнесі —
 * caller передасть її в `input.categoryPurpose`, цей дефолт перекриється.
 *
 * Джерело: docs/product/qr-spec/diff-002-003.md "Поле 10".
 */
const FUNCTION_DEFAULT = 'UCT';
const CATEGORY_PURPOSE_DEFAULT = 'OTHR/GDDS';

/**
 * Pure builder NBU payload формату 003.
 *
 * Послідовність відповідно до Додатка 4 §IV.10 ст. 28:
 *   1. Валідація input через Zod (`PayloadInputSchema`).
 *   2. Per-field length-asserts через `FIELD_LIMITS['003']`.
 *   3. Збір 17 рядків у точному порядку зі специфікації (Додаток 4 таблиця 2).
 *   4. `join('\n')` (виключно Lf — обовʼязкова норма для 003, §III.7 ст. 28).
 *   5. Загальний size-assert ≤ 507 B (§IV.8 ст. 28).
 *
 * **Trailing-empty fields обовʼязкові** (Унікальний ідентифікатор, Електронний
 * підпис) — payload коротший на одне поле = invalid format у банк-парсерах.
 * Масив `fields` тут точно 17 елементів.
 *
 * **Опціональні поля без переданого значення** (Reference, Відображення,
 * Код заборони, ValidUntil, IssuedAt) → порожні рядки у payload (норматив
 * §III.6 ст. 26: «Оп.» = присутній, може бути порожнім).
 *
 * **Кодування**: завжди `1` (UTF-8) — той самий аргумент, що в `build002Payload`.
 */
export function build003Payload(rawInput: unknown): string {
    const input = parseInput(rawInput, '003');

    // Resolve optional inputs.
    const fn = input.function ?? FUNCTION_DEFAULT;
    const categoryPurpose = input.categoryPurpose ?? CATEGORY_PURPOSE_DEFAULT;
    const reference = input.reference ?? '';
    const display = input.display ?? '';
    const fieldLockMask = input.fieldLockMask ?? '';
    const validUntil = input.validUntil ?? '';
    const issuedAt = input.issuedAt ?? '';

    // NBU-allowed charset для текстових полів. Викликається до length-перевірок,
    // бо overflow-error на полі з нелегітимним char менш інформативний за
    // PAYLOAD_INVALID_CHARSET. categoryPurpose валідується regex'ом у Zod —
    // там лише ASCII a-z/A-Z + slash, charset гарантований.
    assertNbuCharset('receiverName', input.receiverName, '003');
    assertNbuCharset('purpose', input.purpose, '003');
    if (reference.length > 0) assertNbuCharset('reference', reference, '003');
    if (display.length > 0) assertNbuCharset('display', display, '003');

    // Per-field length checks (тільки для текстових Z-полів; решта — fixed-format).
    assertField(
        'receiverName',
        input.receiverName,
        FIELD_LIMITS['003'].receiverName,
        '003'
    );
    assertField(
        'purpose',
        input.purpose,
        FIELD_LIMITS['003'].purpose,
        '003'
    );
    assertField(
        'categoryPurpose',
        categoryPurpose,
        FIELD_LIMITS['003'].categoryPurpose,
        '003'
    );
    if (reference.length > 0) {
        assertField(
            'reference',
            reference,
            FIELD_LIMITS['003'].reference,
            '003'
        );
    }
    if (display.length > 0) {
        assertField('display', display, FIELD_LIMITS['003'].display, '003');
    }

    const amountCurrency = formatAmountCurrency(input.amountKopecks);

    const fields: readonly string[] = [
        'BCD', // 1: Службова мітка
        '003', // 2: Версія формату
        '1', // 3: Кодування — UTF-8
        fn, // 4: Функція — UCT/ICT/XCT
        '', // 5: Унікальний ідентифікатор отримувача — RFU
        input.receiverName, // 6: Отримувач
        input.iban, // 7: Рахунок отримувача
        amountCurrency, // 8: Сума / валюта
        input.receiverTaxId, // 9: Код отримувача
        categoryPurpose, // 10: Категорія / ціль (CCCC/PPPP)
        reference, // 11: Reference (Оп.)
        input.purpose, // 12: Призначення платежу
        display, // 13: Відображення (Оп.)
        fieldLockMask, // 14: Код заборони зміни полів (Оп., hex)
        validUntil, // 15: Дата/час дії рахунку (Оп., YYMMDDHHmmss)
        issuedAt, // 16: Дата/час формування (Оп., YYMMDDHHmmss)
        '', // 17: Електронний підпис — RFU
    ];

    const payload = fields.join(ROW_TERMINATOR);
    assertOverallSize(payload, '003');
    return payload;
}

/**
 * Кількість полів у payload формату 003 (для round-trip перевірок).
 */
export const PAYLOAD_003_FIELD_COUNT = 17;
