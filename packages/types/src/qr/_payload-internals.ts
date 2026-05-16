/**
 * Internal helpers, спільні для `payload-002` і `payload-003`. Не експортуються
 * з `qr/index.ts` — це implementation detail, не public API.
 *
 * Назва з префіксом `_` — конвенція для private модулів у packages/types
 * (аналогічно усталеному JS underscore-prefix для internal членів).
 */

import {
    FIELD_LIMITS,
    PAYLOAD_OVERALL_BYTE_LIMIT,
    assertWithinUtf8Limits,
    type FieldLimit,
} from './limits';
import { findInvalidNbuCharIndex } from './charset';
import { PayloadValidationError } from './errors';
import type { PayloadVersion } from './format-version';
import { PayloadInputSchema, type PayloadInput } from './input';

/**
 * Розділювач рядків. Норматив:
 *   - 002 (Додаток 3 §III.10 ст. 20) — рекомендований Lf, дозволено Cr+Lf.
 *   - 003 (Додаток 4 §III.7 ст. 28) — виключно Lf.
 * Lf = `\n` для обох — спільний шлях коду без розгалуження по версіях.
 */
export const ROW_TERMINATOR = '\n';

/**
 * Конвертує суму копійок у рядок `UAH<сума>` за правилами нормативу
 * (Додатки 3 §II.4.8 ст. 19, 4 §II.4.8 ст. 27):
 *   - дрібна частина = рівно 2 цифри якщо є, "коротко" якщо немає (мінімізація);
 *   - нулі перед сумою заборонені;
 *   - максимум — 999_999_999.99.
 *
 * `null` → порожній рядок (поле порожнє → клієнт вводить суму в банк-додатку).
 *
 * Overflow перевіряється Zod-схемою на вході (max 99_999_999_999), тому тут
 * додаткового assert не потрібно — це гарантовано контрактом input.ts.
 */
export function formatAmountCurrency(amountKopecks: number | null): string {
    if (amountKopecks === null) {
        return '';
    }
    const hryvnia = Math.floor(amountKopecks / 100);
    const kopecks = amountKopecks % 100;
    if (kopecks === 0) {
        return `UAH${hryvnia}`;
    }
    return `UAH${hryvnia}.${kopecks.toString().padStart(2, '0')}`;
}

/**
 * Per-field length-assertion з типобезпечним мапінгом на коди помилок.
 */
export function assertField(
    field: string,
    value: string,
    limit: FieldLimit,
    version: PayloadVersion
): void {
    const result = assertWithinUtf8Limits(value, limit);
    if (result.ok) return;
    throw new PayloadValidationError(
        result.reason === 'CHARS'
            ? 'PAYLOAD_FIELD_TOO_LONG_CHARS'
            : 'PAYLOAD_FIELD_TOO_LONG_BYTES',
        field,
        version
    );
}

/**
 * Перевіряє, що value складається лише з символів NBU-allowed charset
 * (Додаток 1 §I.4 ст. 4). Викликається для текстових полів user-input
 * (`receiverName`, `purpose`, `reference`, `display`).
 *
 * Найважливіше у цій перевірці — заборона LF (\n) і CR (\r): без неї
 * зловмисний/неуважний caller може передати multi-line value, що зламає
 * кількість полів payload, і банк-парсер відхилить QR.
 */
export function assertNbuCharset(
    field: string,
    value: string,
    version: PayloadVersion
): void {
    const idx = findInvalidNbuCharIndex(value);
    if (idx >= 0) {
        throw new PayloadValidationError(
            'PAYLOAD_INVALID_CHARSET',
            field,
            version,
            `Char at index ${idx} not in NBU-allowed charset (Win1251 mapping minus control chars)`
        );
    }
}

/**
 * Загальний size-assert на готовому payload-рядку.
 * Норматив: ≤ 507 B (Додатки 3 §IV.11, 4 §IV.8).
 */
export function assertOverallSize(
    payload: string,
    version: PayloadVersion
): void {
    const byteLength = new TextEncoder().encode(payload).length;
    if (byteLength > PAYLOAD_OVERALL_BYTE_LIMIT) {
        throw new PayloadValidationError(
            'PAYLOAD_OVERALL_SIZE_EXCEEDED',
            'payload',
            version
        );
    }
}

/**
 * Парсить input через Zod-схему. На помилку видає `PayloadValidationError` з
 * відповідним machine code, без витоку низькорівневих Zod issue-objects до
 * каналу помилок (вони міняли формат між мажорними версіями Zod).
 */
export function parseInput(
    rawInput: unknown,
    version: PayloadVersion
): PayloadInput {
    const parseResult = PayloadInputSchema.safeParse(rawInput);
    if (parseResult.success) {
        return parseResult.data;
    }
    const issue = parseResult.error.issues[0]!;
    throw new PayloadValidationError(
        'PAYLOAD_INVALID_FIELD_FORMAT',
        issue.path.join('.') || 'input',
        version,
        issue.message
    );
}

/**
 * Тип-безпечний accessor для FIELD_LIMITS — чистий проксі, але потрібен щоб
 * payload-002.ts/payload-003.ts не дублювали імпорт. Реекспорт ré-export-у.
 */
export { FIELD_LIMITS };
