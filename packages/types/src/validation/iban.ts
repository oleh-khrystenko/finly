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

export function isValidIban(value: string): boolean {
    if (typeof value !== 'string') return false;
    if (value.length !== UA_IBAN_LENGTH) return false;
    if (!UA_IBAN_PATTERN.test(value)) return false;
    const rearranged = value.slice(4) + value.slice(0, 4);
    return mod97(rearranged) === 1;
}

export const ibanZod = z
    .string()
    .refine(isValidIban, { message: 'INVALID_IBAN' });

export type Iban = z.infer<typeof ibanZod>;
