/**
 * Sprint 29 — стан запиту отримувача на публічність (потрапляння у каталог):
 *  - `none`     — не запитано (дефолт для звичайних бізнесів).
 *  - `pending`  — запит подано, чекає на розгляд адміна.
 *  - `approved` — схвалено: отримувач допущений у каталог (реальна видимість
 *                 додатково вимагає увімкнених прапорів видимості і красивого slug).
 *  - `rejected` — відхилено адміном (з причиною); користувач може подати знову.
 *
 * Системні отримувачі (`Business.isSystem`) у каталозі без запиту, тож їхній
 * `publicityStatus` лишається `none` і не використовується.
 */
export const PUBLICITY_STATUSES = [
    'none',
    'pending',
    'approved',
    'rejected',
] as const;

export type PublicityStatus = (typeof PUBLICITY_STATUSES)[number];

/**
 * Дефолт для нових і для pre-Sprint-29 документів. Іменована константа, щоб
 * schema-default, беквіл-міграція і `$ifNull`-фолбек в агрегації не розʼїхались:
 * усі значення тут валідні члени enum, тож дрейф був би невидимий.
 */
export const DEFAULT_PUBLICITY_STATUS: PublicityStatus = 'none';
