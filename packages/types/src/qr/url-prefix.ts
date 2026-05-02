/**
 * NBU QR payload-link URL prefixes — постанова Правління НБУ № 97 від
 * 19.08.2025, чинна з 01.11.2025.
 *
 * Джерело правди: `docs/product/qr-spec/README.md` секція «Host у нормативі».
 * Решта QR-builder примітивів (FIELD_LIMITS, FIELD_ORDER, payload builders) —
 * у наступних файлах sprint 2 §2.1; цей файл живе окремо, бо `url-prefix`
 * консумується ще на API config-layer (env whitelist у `apps/api/src/config/env.ts`).
 */

/**
 * Format 002 (fallback): фіксований нормативом (Додаток 3 §I таблиця 1 — 23B fixed).
 * НБУ дозволяє два значення (`https://qr.bank.gov.ua/` і `https://bank.gov.ua/qr/`),
 * але для 002 ми обираємо legacy-сумісний варіант — він поширений у банк-парсерах,
 * що ще не оновились до 003-чинного `qr.bank.gov.ua`.
 */
export const URL_PREFIX_002 = 'https://bank.gov.ua/qr/' as const;

/**
 * Format 003 (основний): host — змінна (Додаток 4 §I таблиця 1 — 50B max var).
 * Норматив додатково дозволяє «персоніфікований код старту застосунку» з доменом
 * надавача платіжних послуг (банку) — але Finly не НПП, тому з допустимих
 * варіантів нам залишаються лише ці два.
 *
 * Default: `qr.bank.gov.ua` (рекомендований нормативом для 003).
 * Fallback: `bank.gov.ua/qr` (на випадок, якщо UAT QR-6 виявить банки, що не
 * оновили `apple-app-site-association`/`assetlinks.json` під qr.bank.gov.ua).
 */
export const ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003 = [
    'qr.bank.gov.ua',
    'bank.gov.ua/qr',
] as const;

export type AllowedNbuPayloadLinkHost003 =
    (typeof ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003)[number];

export const isAllowedNbuPayloadLinkHost003 = (
    value: string
): value is AllowedNbuPayloadLinkHost003 =>
    (ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003 as readonly string[]).includes(value);
