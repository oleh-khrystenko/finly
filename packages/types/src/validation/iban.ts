import { z } from 'zod';

/**
 * Український IBAN: `UA` + 27 цифр (29 символів загалом). Формат фіксований
 * стандартом НБУ і ISO 13616.
 *
 * Перевірка checksum'у — алгоритм MOD-97 (ISO 7064 Mod 97-10):
 *   1. Перенести перші 4 символи (`UA` + 2 цифри check) у кінець.
 *   2. Замінити літери на числа: `A=10, B=11, …, Z=35`.
 *   3. Інтерпретувати результат як десяткове число → mod 97 має дорівнювати 1.
 *
 * Чому BigInt-варіант неоптимальний: 31-значне число в JS — це BigInt-арифметика
 * на кожен виклик. Для CRUD-валідації використовуємо потоковий running-mod
 * (digit-by-digit), що дає той самий результат у O(n) без BigInt-залежності.
 */

const UA_IBAN_LENGTH = 29;
const UA_IBAN_PATTERN = /^UA\d{27}$/;

function letterToNumeric(c: string): string {
    return String(c.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
}

function mod97(rearranged: string): number {
    let remainder = 0;
    for (const c of rearranged) {
        const chunk = c >= 'A' && c <= 'Z' ? letterToNumeric(c) : c;
        for (const digit of chunk) {
            remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
        }
    }
    return remainder;
}

/**
 * Прибирає всі пробіли і приводить до верхнього регістру. IBAN усюди (банк-
 * додаток, договори, виписки) показується групами по 4 з пробілами, тому
 * скопійоване значення майже завжди приходить як `UA21 3223 …`. Нормалізуємо
 * на вводі — інакше `UA_IBAN_PATTERN` відхиляє пробіли, а помилка про це не
 * натякає.
 */
export function normalizeIban(value: string): string {
    return value.replace(/\s+/g, '').toUpperCase();
}

/** Структурна перевірка: рівно 29 символів — `UA` + 27 цифр. */
export function hasValidIbanFormat(value: string): boolean {
    if (typeof value !== 'string') return false;
    if (value.length !== UA_IBAN_LENGTH) return false;
    return UA_IBAN_PATTERN.test(value);
}

/** Перевірка контрольної суми MOD-97 (передбачає валідний формат). */
export function hasValidIbanChecksum(value: string): boolean {
    const rearranged = value.slice(4) + value.slice(0, 4);
    return mod97(rearranged) === 1;
}

export function isValidIban(value: string): boolean {
    return hasValidIbanFormat(value) && hasValidIbanChecksum(value);
}

/**
 * Два окремі коди замість одного `INVALID_IBAN`, бо причини помилки різні і
 * повідомлення для них мусять бути різні:
 *  - `INVALID_IBAN_FORMAT` — не той розмір/символи (користувач недовів номер);
 *  - `INVALID_IBAN_CHECKSUM` — формат правильний, але контрольна сума не
 *    зійшлася (описка в одній цифрі). Тут «29 символів, починається з UA»
 *    було б брехнею — людина це виконала, помилка глибша.
 *
 * Порядок refine важливий: checksum-refine пропускає невалідний-за-форматом
 * вхід (`!hasValidIbanFormat → true`), щоб не дублювати помилку — RHF показує
 * лише перший issue, тож format-помилка має йти першою.
 */
export const ibanZod = z
    .string()
    .refine(hasValidIbanFormat, { message: 'INVALID_IBAN_FORMAT' })
    .refine((v) => !hasValidIbanFormat(v) || hasValidIbanChecksum(v), {
        message: 'INVALID_IBAN_CHECKSUM',
    });

export type Iban = z.infer<typeof ibanZod>;
