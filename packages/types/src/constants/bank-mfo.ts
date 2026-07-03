import { type BankCode } from './banks';

/**
 * Sprint 9 §SP-9 — `BANK_MFO_MAP` резолвить МФО → `BankCode` для
 * `AccountsService.create` (auto-name + stored `bankCode` field).
 *
 * **Структура UA IBAN** (стандарт НБУ + ISO 13616):
 *   `UA<2-digit check><6-digit МФО><19-digit account>` = 29 chars total.
 *
 * МФО — публічний 6-цифровий ідентифікатор банку у системі НБУ; стабільний
 * протягом років (рідкі зміни при злитті / реорганізації банків). Reverse-
 * lookup `МФО → BankCode` живе як stored field на Account-документі (§SP-9),
 * а не runtime-resolve на read.
 *
 * **На unknown МФО** (`bankCodeFromIban` повертає `null`) — UI ховає
 * bank-label-row (§SP-9 4-точковий invariant); auto-name fallback-ить на
 * `"Банк •{last4}"`. Це коректна graceful degradation для дрібних регіональних
 * банків поза MVP-набором.
 *
 * **Verification status:** 10 записів `VERIFIED 2026-05-11` — звірено з
 * minfin.com.ua, bank.gov.ua (Licences_bank PDF), офіційними сайтами банків та
 * opendatabot. Sprint 9 повний verification-pass (попередня версія мала 9
 * BEST-EFFORT записів — закрито перед merge). Запис ukrsibbank додано пізніше
 * (`VERIFIED 2026-07-02`, окреме джерело у рядку).
 *
 * **При додаванні нового запису** (Sprint 10+, розширення MVP_BANKS):
 *   1. Відкрити bank.gov.ua → "Реєстр банків і філій" АБО `bank.gov.ua/files/
 *      Licences_bank/{мфо}.pdf` — за naming-convention NBU.
 *   2. Знайти юр-особу банку у списку.
 *   3. Скопіювати МФО (6 цифр).
 *   4. Додати рядок з маркером `VERIFIED <дата>` + джерело.
 */
export const BANK_MFO_MAP: Readonly<Record<string, BankCode>> = {
    // VERIFIED 2026-05-11 — privatbank.ua/rules footer + Wikipedia URL pattern
    // (bank.gov.ua/files/Shareholders/305299/index.html у статті ПриватБанк).
    '305299': 'privatbank',
    // VERIFIED 2026-05-11 — oschadbank.ua/contacts: "МФО 300465" у розділі
    // "Ліцензія банку".
    '300465': 'oschadbank',
    // VERIFIED 2026-05-11 — АТ "Універсал Банк" (юр-особа monobank-product);
    // minfin.com.ua/ua/company/universal-bank + bank.gov.ua/en/supervision/
    // institutions/21133352 + universalbank.com.ua реквізити-PDF.
    '322001': 'monobank',
    // VERIFIED 2026-05-11 — АТ "ПУМБ" (Перший Український Міжнародний Банк);
    // about.pumb.ua/info + minfin.com.ua/ua/company/pumb + bank.gov.ua/en/
    // supervision/institutions/14282829.
    '334851': 'pumb',
    // VERIFIED 2026-05-11 — АТ "Sense Bank" (раніше Альфа-Банк Україна, МФО
    // успадковане при ребрендингу 2022, націоналізація 2023);
    // minfin.com.ua/ua/company/sensebank + bank.gov.ua/en/supervision/
    // institutions/23494714.
    '300346': 'sense',
    // VERIFIED 2026-05-11 — АБ "Укргазбанк"; minfin.com.ua/ua/company/
    // ukrgasbank + bank.gov.ua/en/supervision/institutions/23697280 +
    // dovidnyk.in.ua/directories/banks/mfo/320478.
    '320478': 'ukrgazbank',
    // VERIFIED 2026-05-11 — АТ "ТАСКОМБАНК" (юр-особа IZIBank-product);
    // bank.gov.ua/files/Licences_bank/339500.pdf + tascombank.ua/neobank-
    // partners/izibank + izibank.com.ua official.
    // Sprint 9 note: колишній SportBank теж працював на цьому ж МФО (один
    // банк = один МФО). Після закриття SportBank 06.05.2024 — клієнти
    // переведені у ТАСКОМБАНК; sportbank як окремий BankCode прибрано з
    // MVP_BANKS у тому ж комміті, де ця нотатка з'явилася.
    '339500': 'izibank',
    // VERIFIED 2026-05-11 — АТ "Райффайзен Банк" (раніше Райффайзен Банк
    // Аваль, перехід з 380805 на 300335 у рамках "Трансформація Райфу");
    // raiffeisen.ua/perehid-na-mfo-300335 + bank.gov.ua/files/Licences_bank/
    // 300335.pdf + bank.gov.ua/en/supervision/institutions/14305909.
    '300335': 'raiffeisen',
    // VERIFIED 2026-05-11 — АТ "Акцент-Банк" (A-Bank); minfin.com.ua/ua/
    // company/a-bank + bankchart.com.ua/spravochniki/rekvizity_bankov/id/71
    // + a-bank.com.ua/static/requisites_abank.pdf.
    '307770': 'abank',
    // VERIFIED 2026-05-11 — АТ "Банк Кредит Дніпро"; bank.gov.ua/files/
    // Licences_bank/305749.pdf + bank.gov.ua/en/supervision/institutions/
    // 14352406 + minfin.com.ua/ua/company/credit-dnepr.
    '305749': 'credit_dnipro',
    // VERIFIED 2026-07-02 — АТ "УКРСИББАНК" (BNP Paribas Group, ЄДРПОУ
    // 09807750); bank.gov.ua/files/Licences_bank/351005.pdf +
    // ukrsibbank.com/about-bank/requisites + minfin.com.ua/ua/company/ukrsibbank.
    '351005': 'ukrsibbank',
};

const MFO_START_INDEX = 4;
const MFO_END_INDEX = 10;
const UA_IBAN_MIN_LENGTH = 10;

/**
 * Резолвить `BankCode` з UA IBAN через extract МФО + lookup у `BANK_MFO_MAP`.
 *
 * **Defensive parsing** (не повторює `isValidIban` checksum-перевірку — те
 * робить `ibanZod` на write-DTO):
 *  - Коротший за 10 chars → `null` (МФО займає позиції 4..9, потрібен хоча б
 *    цей сегмент). Sprint 8-style preview-flow може передати IBAN у проміжному
 *    стані вводу, де ще не всі символи набрані.
 *  - Префікс не `UA` → `null` (інші країни поза MVP).
 *  - МФО-сегмент має не-digit → `null` (corrupt input у legacy-документах).
 *  - МФО не у `BANK_MFO_MAP` → `null` (дрібний регіональний банк).
 *
 * Sprint 9 §SP-9 — викликається рівно один раз у `AccountsService.create`;
 * результат пишеться як stored `bankCode` field. Read-path серіалізує stored
 * value напряму, без runtime-re-resolve (avoid drift при майбутніх змінах
 * `BANK_MFO_MAP`).
 */
export function bankCodeFromIban(iban: string): BankCode | null {
    if (iban.length < UA_IBAN_MIN_LENGTH) return null;
    if (!iban.startsWith('UA')) return null;
    const mfoSegment = iban.slice(MFO_START_INDEX, MFO_END_INDEX);
    if (!/^\d{6}$/.test(mfoSegment)) return null;
    return BANK_MFO_MAP[mfoSegment] ?? null;
}
