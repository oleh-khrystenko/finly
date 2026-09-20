import { hasRealCardNumber, toCardPaymentMethod } from './card-payment-method';

describe('toCardPaymentMethod', () => {
    it('пропускає відомі значення провайдера', () => {
        expect(toCardPaymentMethod('apple')).toBe('apple');
        expect(toCardPaymentMethod('pan')).toBe('pan');
        expect(toCardPaymentMethod('wallet')).toBe('wallet');
    });

    it('гасить незнайоме значення у null замість того, щоб пропустити його далі', () => {
        expect(toCardPaymentMethod('samsung')).toBeNull();
        expect(toCardPaymentMethod('')).toBeNull();
        expect(toCardPaymentMethod(null)).toBeNull();
    });
});

describe('hasRealCardNumber', () => {
    it('ховає цифри для гаманців: там номер належить пристрою, не картці', () => {
        expect(hasRealCardNumber('apple')).toBe(false);
        expect(hasRealCardNumber('google')).toBe(false);
    });

    it('показує цифри там, де номер справді від картки платника', () => {
        expect(hasRealCardNumber('pan')).toBe(true);
        expect(hasRealCardNumber('monobank')).toBe(true);
        expect(hasRealCardNumber('direct')).toBe(true);
    });

    it('ховає цифри для списання токеном: токен міг бути створений з гаманця', () => {
        expect(hasRealCardNumber('wallet')).toBe(false);
    });

    it('ховає цифри, коли спосіб невідомий — інакше номер пристрою поїхав би як номер картки', () => {
        expect(hasRealCardNumber(null)).toBe(false);
    });
});
