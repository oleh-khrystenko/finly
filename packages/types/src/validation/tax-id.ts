import { z } from 'zod';

/**
 * ІПН (індивідуальний податковий номер) фізичної особи / ФОП в Україні.
 *
 * Формат — рівно 10 десяткових цифр. 10-та цифра — контрольна, обчислюється з
 * перших 9 за алгоритмом ДПС (постанова з зміна податкового реєстру):
 *
 *   weights = [-1, 5, 7, 9, 4, 6, 10, 5, 7]
 *   control = (Σ digit_i × weight_i) mod 11 mod 10
 *
 * Зовнішня операція `mod 10` потрібна для випадку, коли `Σ mod 11 == 10`:
 * контрольна цифра не може бути двозначною, тому згортається у `0`.
 *
 * **Не реалізуємо**: ЄДРПОУ-валідатор (для ТОВ/ВАТ — Phase 1.5+); валідація
 * дати народження, закодованої у перших 5 цифрах ІПН (це окреме business-rule,
 * не частина checksum-перевірки).
 */

const IPN_LENGTH = 10;
const IPN_PATTERN = /^\d{10}$/;
const IPN_WEIGHTS = [-1, 5, 7, 9, 4, 6, 10, 5, 7] as const;

function controlDigit(first9: string): number {
    let sum = 0;
    for (let i = 0; i < IPN_WEIGHTS.length; i++) {
        sum += (first9.charCodeAt(i) - 48) * IPN_WEIGHTS[i]!;
    }
    return ((sum % 11) + 11) % 11 % 10;
}

export function isValidIndividualTaxId(value: string): boolean {
    if (typeof value !== 'string') return false;
    if (value.length !== IPN_LENGTH) return false;
    if (!IPN_PATTERN.test(value)) return false;
    const expected = controlDigit(value.slice(0, 9));
    const actual = value.charCodeAt(9) - 48;
    return expected === actual;
}

export const individualTaxIdZod = z
    .string()
    .refine(isValidIndividualTaxId, { message: 'INVALID_TAX_ID' });

export type IndividualTaxId = z.infer<typeof individualTaxIdZod>;
