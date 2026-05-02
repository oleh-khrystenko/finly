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
 * Pure builder NBU payload формату 002.
 *
 * Послідовність відповідно до Додатка 3 §IV.14 ст. 21:
 *   1. Валідація input через Zod (`PayloadInputSchema`).
 *   2. Per-field length-asserts через `FIELD_LIMITS['002']`.
 *   3. Збір 13 рядків у точному порядку зі специфікації (Додаток 3 таблиця 2).
 *   4. `join('\n')` (рекомендований роздільник для 002 — §III.10 ст. 20).
 *   5. Загальний size-assert ≤ 507 B (§IV.11 ст. 21).
 *
 * **Trailing-empty fields обовʼязкові** (BIC, Ціль, Reference, Відображення):
 * payload коротший на одне поле = invalid format у банк-парсерах. Масив `fields`
 * тут точно 13 елементів — навіть RFU-поля представлені порожніми рядками.
 *
 * **003-only поля input ігноруються** (function, categoryPurpose, reference,
 * display, fieldLockMask, validUntil, issuedAt) — у 002 нормативу їх немає.
 *
 * **Кодування**: завжди `1` (UTF-8). Win1251 (`2`) можна декодувати, але
 * пишемо тільки UTF-8 — консистентно з усім стеком Finly (TS string = UTF-16,
 * Mongo = UTF-8, JSON = UTF-8). Read-side підтримка Win1251 — для round-trip
 * декодера в Sprint 2 §2.3.
 */
export function build002Payload(rawInput: unknown): string {
    const input = parseInput(rawInput, '002');

    assertNbuCharset('receiverName', input.receiverName, '002');
    assertNbuCharset('purpose', input.purpose, '002');

    assertField(
        'receiverName',
        input.receiverName,
        FIELD_LIMITS['002'].receiverName,
        '002'
    );
    assertField(
        'purpose',
        input.purpose,
        FIELD_LIMITS['002'].purpose,
        '002'
    );

    const amountCurrency = formatAmountCurrency(input.amountKopecks);

    const fields: readonly string[] = [
        'BCD', // 1: Службова мітка
        '002', // 2: Версія формату
        '1', // 3: Кодування — UTF-8 (норматив дозволяє 1 або 2)
        'UCT', // 4: Функція — Ukrainian Credit Transfer
        '', // 5: BIC — RFU (зарезервовано)
        input.receiverName, // 6: Отримувач
        input.iban, // 7: Рахунок отримувача
        amountCurrency, // 8: Сума / валюта
        input.receiverTaxId, // 9: Код отримувача
        '', // 10: Ціль — RFU
        '', // 11: Reference — RFU
        input.purpose, // 12: Призначення платежу
        '', // 13: Відображення — RFU
    ];

    const payload = fields.join(ROW_TERMINATOR);
    assertOverallSize(payload, '002');
    return payload;
}

/**
 * Кількість полів у payload формату 002 (для round-trip перевірок у тестах
 * і Sprint 2 §2.3 інтеграційному тесті з `jsqr` decoder).
 */
export const PAYLOAD_002_FIELD_COUNT = 13;
