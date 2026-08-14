/**
 * Спосіб, яким пройшла оплата (`paymentInfo.paymentMethod` у відповіді monobank):
 *  - `pan`      — платник ввів номер картки руками;
 *  - `apple`    — Apple Pay;
 *  - `google`   — Google Pay;
 *  - `monobank` — оплата всередині застосунку monobank;
 *  - `wallet`   — списання збереженим токеном картки;
 *  - `direct`   — оплата за реквізитами (доступна лише мерчанту з PCI DSS; ми не використовуємо).
 */
export const CARD_PAYMENT_METHODS = [
    'pan',
    'apple',
    'google',
    'monobank',
    'wallet',
    'direct',
] as const;

export type CardPaymentMethod = (typeof CARD_PAYMENT_METHODS)[number];

/**
 * Звужує сире значення від провайдера до відомого способу оплати. Незнайоме
 * значення (monobank розширив перелік) дає `null` — кабінет покаже картку без
 * позначки способу, замість того щоб уронити розбір події списання.
 */
export function toCardPaymentMethod(
    raw: string | null
): CardPaymentMethod | null {
    return CARD_PAYMENT_METHODS.find((method) => method === raw) ?? null;
}

/**
 * Чи є `maskedPan` номером справжньої картки платника.
 *
 * Для Apple Pay і Google Pay — ні: гаманець підставляє окремий номер пристрою
 * (DPAN), і його цифри не збігаються з пластиком. Платіжна система знає останні
 * цифри справжньої картки, але monobank їх назовні не віддає — у `paymentInfo`
 * є рівно одне поле з номером. Тому для гаманців цифри не показуємо взагалі:
 * впізнати по них картку неможливо, а виглядають вони як помилка.
 *
 * `null` (спосіб невідомий — записи до появи поля) трактуємо як справжній номер:
 * так поводився кабінет раніше, і для більшості оплат це правда. Беквіл-скрипт
 * `backfill-card-payment-method` добирає спосіб із monobank заднім числом.
 */
export function hasRealCardNumber(method: CardPaymentMethod | null): boolean {
    return method !== 'apple' && method !== 'google';
}
