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
