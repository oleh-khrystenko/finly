import { hasRealCardNumber, type CardDetails } from '@finly/types';

const WALLET_LABELS: Partial<
    Record<NonNullable<CardDetails['cardPaymentMethod']>, string>
> = {
    apple: 'Apple Pay',
    google: 'Google Pay',
};

const PAYMENT_SYSTEM_LABELS: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
};

function formatPaymentSystem(system: string): string {
    return (
        PAYMENT_SYSTEM_LABELS[system.toLowerCase()] ??
        system.charAt(0).toUpperCase() + system.slice(1)
    );
}

/**
 * Підпис прив'язаної картки для кабінету. Цифри показуємо лише тоді, коли вони
 * справді належать картці платника: для Apple Pay і Google Pay гаманець
 * підставляє номер пристрою, і впізнати по ньому свою картку неможливо — тож
 * замість цифр лишається назва гаманця, платіжна система і банк-емітент, які
 * впізнаються і для гаманцевої оплати (`hasRealCardNumber`).
 *
 * `null` — показувати нічого (даних про картку ще немає).
 */
export function formatCardLabel(card: CardDetails): string | null {
    const wallet = card.cardPaymentMethod
        ? WALLET_LABELS[card.cardPaymentMethod]
        : undefined;
    const issuer = [
        card.cardPaymentSystem
            ? formatPaymentSystem(card.cardPaymentSystem)
            : null,
        card.cardBank,
    ]
        .filter((part): part is string => Boolean(part))
        .join(' ');
    const digits =
        hasRealCardNumber(card.cardPaymentMethod) && card.cardMask
            ? card.cardMask
            : null;

    const parts = [wallet, issuer, digits].filter((part): part is string =>
        Boolean(part)
    );
    return parts.length > 0 ? parts.join(' · ') : null;
}
