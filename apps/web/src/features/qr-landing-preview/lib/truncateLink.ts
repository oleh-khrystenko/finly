/**
 * Sprint 8 §8.3 — обрізає universal-NBU-link до видимого host + N
 * перших chars payload-у з ellipsis.
 *
 * **Чому "host + 10 chars + ellipsis", а не середина-вирізана-ellipsis**:
 * користувач довіряє host-у (`qr.bank.gov.ua`) і використовує початок
 * унікальної частини як "це не той самий, що інший QR" сигнал. Обрізання
 * хвоста зберігає host-trust + унікальність-візуальну. Класичний
 * `start...end` pattern спричинив би недовіру — користувач не знає що
 * вирізано посередині.
 *
 * Pure function — без React-залежностей; spec-test поряд як unit.
 */
export function truncateLink(link: string, payloadHeadChars = 10): string {
    const slashIdx = link.indexOf('/', 8); // після "https://"
    if (slashIdx === -1) return link;
    // Якщо link уже коротший за "host + N chars payload-у", обрізати нічого —
    // повертаємо as-is без зайвого "…" наприкінці. Без цього guard-а
    // `truncateLink('http://x/abc')` повернув би `'http://x/abc…'` — degraded
    // UX для коротких / degenerate URLs (test fixtures, malformed responses;
    // у production NBU URL завжди `qr.bank.gov.ua/<150+ chars>`, тож edge
    // не тригериться, але правильна поведінка — explicit guard, не assume).
    if (slashIdx + 1 + payloadHeadChars >= link.length) return link;
    const head = link.slice(0, slashIdx + 1 + payloadHeadChars);
    return `${head}…`;
}
