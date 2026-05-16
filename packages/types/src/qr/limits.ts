/**
 * Per-field length-обмеження за специфікацією НБУ.
 * Джерело: docs/product/qr-spec/README.md (Додатки 3 і 4 постанови № 97).
 *
 * Окремі `chars` і `bytes`, бо стандарт оперує `C` (chars) для текстових полів
 * і `B` (bytes) для решти. JS `.length` рахує UTF-16 code units (≈ chars), а
 * cyrillic у UTF-8 — 2 байти на character. Без розрізнення legitimate ФОП-кейс
 * ("ТОВ Кав'ярня") мовчки переповнить byte-limit і зламає payload у банках,
 * що strict-перевіряють byte-довжину.
 */

export interface FieldLimit {
    chars: number;
    bytes: number;
}

interface CommonFields {
    receiverName: FieldLimit;
    purpose: FieldLimit;
}

interface Fields002 extends CommonFields {}

interface Fields003 extends CommonFields {
    categoryPurpose: FieldLimit;
    reference: FieldLimit;
    display: FieldLimit;
}

/**
 * Числа з нормативу:
 *   - chars: точні значення з Додатків 3/4 (поля з типом `C`).
 *   - bytes: для C-полів — `chars * 2` (консервативна верхня межа для cyrillic
 *     UTF-8: більшість cyrillic — 2 B/char, базовий ASCII — 1 B). Для полів з
 *     типом `B` у нормативі — точно. Per-field assertion при overflow дає
 *     кращу UX-помилку, ніж сумарне overflow на 507 B.
 */
export const FIELD_LIMITS = {
    '002': {
        receiverName: { chars: 140, bytes: 280 },
        purpose: { chars: 420, bytes: 840 },
    } satisfies Fields002,
    '003': {
        receiverName: { chars: 140, bytes: 280 },
        purpose: { chars: 420, bytes: 840 },
        categoryPurpose: { chars: 9, bytes: 9 },
        reference: { chars: 35, bytes: 35 },
        display: { chars: 140, bytes: 280 },
    } satisfies Fields003,
} as const;

/**
 * Жорсткий загальний ліміт payload (декодованої структури QR-коду до Base64URL):
 * Додаток 3 §IV.11 ст. 21 для 002, Додаток 4 §IV.8 ст. 28 для 003.
 */
export const PAYLOAD_OVERALL_BYTE_LIMIT = 507;

/**
 * Ліміт Base64URL-закодованої структури (frame): таблиця 1 у Додатках 3 і 4.
 */
export const PAYLOAD_BASE64URL_BYTE_LIMIT = 475;

export type AssertResult =
    | { ok: true }
    | { ok: false; reason: 'CHARS' | 'BYTES'; actual: number; limit: number };

/**
 * Кількість байтів у UTF-8 representation рядка. Isomorphic — `TextEncoder`
 * доступний у Node ≥18 і всіх сучасних браузерах, без `Buffer`.
 *
 * Виноситься як окрема функція, бо консумується і `assertWithinUtf8Limits`
 * (внутрішня перевірка builder'а), і Zod refines на entity-схемах
 * (`Business.name`, `Invoice.paymentPurpose` — Sprint 2 §2.2). Симетрія
 * read/write path: одна функція, одне джерело правди для UTF-8 byte counting.
 */
export function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

/**
 * Boolean-варіант byte-only перевірки для Zod refines на entity-рівні.
 * Приклад використання у Business/Invoice schema:
 *   `.refine(v => isWithinByteLimit(v, effectiveLimit('purpose').bytes), ...)`
 */
export function isWithinByteLimit(value: string, byteLimit: number): boolean {
    return utf8ByteLength(value) <= byteLimit;
}

/**
 * Перевіряє рядок проти `chars` і `bytes` лімітів окремо.
 *
 * Чому окремі коди для chars і bytes — для розрізнення UX-помилок:
 *   - "Назва компанії…" 145 chars / 290 B — overflow chars (UX: "коротша назва").
 *   - "ТОВ Кав'ярня" 140 chars / 285 B — overflow bytes (UX: "латиницею або
 *     коротша назва — кирилиця займає більше місця").
 */
export function assertWithinUtf8Limits(
    value: string,
    limit: FieldLimit
): AssertResult {
    if (value.length > limit.chars) {
        return {
            ok: false,
            reason: 'CHARS',
            actual: value.length,
            limit: limit.chars,
        };
    }
    const byteLength = utf8ByteLength(value);
    if (byteLength > limit.bytes) {
        return {
            ok: false,
            reason: 'BYTES',
            actual: byteLength,
            limit: limit.bytes,
        };
    }
    return { ok: true };
}

/**
 * MIN-ліміт по всіх активних версіях — для consumption у Sprint 1 Zod-схемах
 * (`Business.name`, `Invoice.paymentPurpose`). Sprint 2 §2.2.
 *
 * Інваріант: будь-який валідно збережений Business/Invoice може згенерувати
 * валідний QR для будь-якої з підтримуваних версій. Це уникає антипатерну
 * "save succeeds, render later fails".
 *
 * Type-обмеження `keyof CommonFields`: TS не дає викликати effectiveLimit
 * для поля, що існує тільки в одній версії (наприклад, `categoryPurpose`),
 * бо MIN(undefined, x) безглуздий і фактично = x — каже про non-issue.
 */
export function effectiveLimit<F extends keyof CommonFields>(
    field: F
): FieldLimit {
    const v002 = FIELD_LIMITS['002'][field];
    const v003 = FIELD_LIMITS['003'][field];
    return {
        chars: Math.min(v002.chars, v003.chars),
        bytes: Math.min(v002.bytes, v003.bytes),
    };
}
