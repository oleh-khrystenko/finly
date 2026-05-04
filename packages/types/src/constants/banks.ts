/**
 * MVP-набір українських банків — стартовий пул для публічної сторінки бізнесу.
 *
 * Це структурні ідентифікатори (wire-values для БД, Zod, URL); метадані для
 * рендеру (label, logo) живуть на UI-шарі і додаються у Sprint 3. Перелік
 * розширюється за фактом попиту після релізу — список не permanent.
 *
 * Джерело: `docs/product/qr-decisions.md` §1.7.
 */
export const MVP_BANKS = [
    'privatbank',
    'monobank',
    'pumb',
    'oschadbank',
    'sense',
    'ukrgazbank',
    'sportbank',
    'izibank',
    'raiffeisen',
    'abank',
    'credit_dnipro',
] as const;

export type BankCode = (typeof MVP_BANKS)[number];

/**
 * UA-лейбли для UI (wizard step 4, кабінет banks-section, public-сторінка).
 * Sprint 3 рішення B5 каже про реальні логотипи на public-сторінці; cabinet
 * UI Phase 7-8 використовує text labels (іконки додаються разом з public
 * route у Phase 9). Single source of truth — і wizard, і cabinet, і public
 * читають звідси.
 */
export const BANK_LABEL: Record<BankCode, string> = {
    privatbank: 'ПриватБанк',
    monobank: 'monobank',
    pumb: 'ПУМБ',
    oschadbank: 'Ощадбанк',
    sense: 'Sense Bank',
    ukrgazbank: 'Укргазбанк',
    sportbank: 'SportBank',
    izibank: 'IZIBank',
    raiffeisen: 'Raiffeisen',
    abank: 'A-Bank',
    credit_dnipro: 'Кредит Дніпро',
};
