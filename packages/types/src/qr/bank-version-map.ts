import { type BankCode } from '../constants/banks';
import type { PayloadVersion } from './format-version';

/**
 * Mapping bank → payload version, який цей банк коректно зчитує.
 *
 * **Поточний стан (MVP):** усі 11 банків з `MVP_BANKS` мапляться на `'003'` —
 * це новий нормативний формат (постанова НБУ № 97, чинна з 01.11.2025).
 *
 * **Sprint 2 архітектурне рішення (§2.4):** ми надаємо механізм перемикання,
 * не вирішуємо політику. Якщо ФОП feedback покаже, що банк X не приймає 003 —
 * `flip` запис у `'002'` + redeploy. Споживачі (`QrService` у §2.3, UI у
 * Sprint 3) читають з map'и без змін у власному коді.
 *
 * **НЕ робимо runtime per-bank-config у БД** — на масштабі MVP (~100-1000 ФОП)
 * це over-engineering. Перемикання трапиться 0-3 рази на місяць; redeploy
 * дешевий і trackable. Якщо політика дозріє до runtime-config — додається
 * DB-table + admin UI у Phase 1.5.
 *
 * Type `Record<BankCode, PayloadVersion>` гарантує compile-time exhaustivness:
 * додавання банку у `MVP_BANKS` ламає білд тут, поки не додано mapping.
 */
export const BANK_PAYLOAD_VERSION: Record<BankCode, PayloadVersion> = {
    privatbank: '003',
    monobank: '003',
    pumb: '003',
    oschadbank: '003',
    sense: '003',
    ukrgazbank: '003',
    izibank: '003',
    raiffeisen: '003',
    abank: '003',
    credit_dnipro: '003',
    ukrsibbank: '003',
};

/**
 * Lookup-helper: тривіальна обгортка над map'ою. Навіщо функція замість
 * прямого `BANK_PAYLOAD_VERSION[code]`: якщо політика ускладниться (per-FOP
 * override у DB) — змінюємо тут, не в усіх call-site'ах.
 */
export function getPayloadVersionForBank(code: BankCode): PayloadVersion {
    return BANK_PAYLOAD_VERSION[code];
}
