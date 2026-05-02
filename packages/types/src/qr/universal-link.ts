import { PayloadValidationError } from './errors';
import type { PayloadVersion } from './format-version';
import { PAYLOAD_BASE64URL_BYTE_LIMIT } from './limits';
import {
    URL_PREFIX_002,
    isAllowedNbuPayloadLinkHost003,
} from './url-prefix';

export interface BuildLinkOptions {
    /**
     * Host для format 003 — обовʼязковий, якщо `version === '003'`.
     * Має бути з whitelist `ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003` (нормативно
     * за Додатком 4 §I.2.1: `qr.bank.gov.ua` або домен НПП; для Finly як
     * не-НПП — лише `qr.bank.gov.ua` або fallback `bank.gov.ua/qr`).
     *
     * Для version 002 ігнорується — норматив фіксує host у Додатку 3 таблиці 1
     * (23 B fixed: `https://bank.gov.ua/qr/`).
     */
    host?: string;
}

/**
 * Builder universal NBU-payload link.
 *
 * Норматив:
 *   - 002 (Додаток 3 §I таблиця 1, ст. 15): `https://bank.gov.ua/qr/<base64url>`.
 *     Префікс fixed 23 B; конкатенація без розділювача (Додаток 3 §I.2.1).
 *   - 003 (Додаток 4 §I таблиця 1, ст. 23): `https://<host>/<base64url>`.
 *     Host — змінна, до 50 B max.
 *
 * **Whitelist валідація на двох layer-ах:**
 *   1. `apps/api/src/config/env.ts` — fail-fast при старті API (адмін
 *      підставив pay.finly.com.ua або typo).
 *   2. Тут — захист від inline-літералів замість `ENV.NBU_PAYLOAD_LINK_HOST`
 *      у викликаючому коді (caller помилково передав довільний рядок).
 *   Дублювання навмисне — payload-генерація критичний контракт із зовнішнім
 *   світом, дешевше захиститись на двох рівнях.
 */
export function buildNbuPayloadLink(
    version: PayloadVersion,
    base64UrlPayload: string,
    options?: BuildLinkOptions
): string {
    // Спільна для обох версій нормативна перевірка Base64URL frame ≤ 475 B
    // (Додатки 3 і 4, таблиця 1, рядок 2). У b64url alphabet кожен char — 1 ASCII
    // байт, тому `length` == byte-length. Це перевірка більш restrictive за
    // raw-payload 507 B (її робить `assertOverallSize`): практичний ліміт raw
    // payload — ~356 B (бо ceil(N/3)*4 ≤ 475 ⇒ N ≤ 356).
    if (base64UrlPayload.length > PAYLOAD_BASE64URL_BYTE_LIMIT) {
        throw new PayloadValidationError(
            'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
            'base64UrlPayload',
            version
        );
    }

    if (version === '002') {
        return `${URL_PREFIX_002}${base64UrlPayload}`;
    }
    // version === '003'
    const host = options?.host;
    if (!host) {
        throw new PayloadValidationError(
            'PAYLOAD_HOST_REQUIRED',
            'host',
            '003',
            'Format 003 requires `host` option (e.g. ENV.NBU_PAYLOAD_LINK_HOST)'
        );
    }
    if (!isAllowedNbuPayloadLinkHost003(host)) {
        throw new PayloadValidationError(
            'PAYLOAD_NON_COMPLIANT_HOST',
            'host',
            '003'
        );
    }
    return `https://${host}/${base64UrlPayload}`;
}
