import { type CardDetails } from '@finly/types';

/**
 * `$set`-фрагмент даних картки для запису історії списань. Порожні значення не
 * затирають уже відоме: `paymentInfo` приходить не в кожній події.
 *
 * Окремий модуль (а не приватна функція сервісу): ту саму форму запису пише
 * беквіл-скрипт способу оплати, який працює без Nest-контейнера.
 */
export function cardRecordFields(card: CardDetails): Record<string, string> {
    const set: Record<string, string> = {};
    if (card.cardMask) set.cardMask = card.cardMask;
    if (card.cardPaymentMethod) {
        set.cardPaymentMethod = card.cardPaymentMethod;
    }
    if (card.cardPaymentSystem) {
        set.cardPaymentSystem = card.cardPaymentSystem;
    }
    if (card.cardBank) set.cardBank = card.cardBank;
    return set;
}

/**
 * Те саме для профілю платника, але `wallet` НЕ затирає спосіб оплати: так
 * monobank позначає списання збереженим токеном, тобто будь-яке циклове
 * продовження. Перезапис звідти стер би те, чим картку прив'язували, і кабінет
 * після першого ж продовження почав би показувати номер пристрою Apple Pay як
 * номер картки платника (`hasRealCardNumber`). Спосіб осідає на профілі лише з
 * інтерактивної оплати — тієї, де платник справді обирав, чим платити.
 */
export function cardProfileFields(card: CardDetails): Record<string, string> {
    const set = cardRecordFields(card);
    if (card.cardPaymentMethod === 'wallet') delete set.cardPaymentMethod;
    return set;
}
