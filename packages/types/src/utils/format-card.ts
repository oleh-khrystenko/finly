import type { CardDetails } from '../contracts/payments';
import {
    hasRealCardNumber,
    type CardPaymentMethod,
} from '../enums/card-payment-method';

const WALLET_LABELS: Partial<Record<CardPaymentMethod, string>> = {
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
 * Впізнаваний опис картки: назва гаманця, платіжна система і банк-емітент, а
 * цифри — лише коли вони справді від картки платника (`hasRealCardNumber`).
 * Для Apple Pay / Google Pay `maskedPan` належить номеру пристрою, і показ цих
 * цифр як номера картки збиває з пантелику саме там, де людина звіряє картку.
 *
 * Спільний для кабінету і листів навмисно: опис однієї й тієї самої картки не
 * може розходитись між сторінкою і безпековим сповіщенням — розбіжність читалась
 * би як підміна картки.
 *
 * `null` — описати нічим (про картку не відомо нічого впізнаваного); що казати
 * у такому разі, вирішує місце показу.
 */
export function describeCard(card: CardDetails): string | null {
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
