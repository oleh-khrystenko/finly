import type { CardDetails } from '@finly/types';
import { formatCardLabel } from './formatCard';

const card = (over: Partial<CardDetails> = {}): CardDetails => ({
    cardMask: '444403******1902',
    cardPaymentMethod: 'pan',
    cardPaymentSystem: 'mastercard',
    cardBank: 'ПриватБанк',
    ...over,
});

describe('formatCardLabel', () => {
    it('показує номер, коли платили введеною карткою', () => {
        expect(formatCardLabel(card())).toBe(
            'Mastercard ПриватБанк · 444403******1902'
        );
    });

    it('ховає номер для Apple Pay, лишаючи впізнавані систему і банк', () => {
        expect(formatCardLabel(card({ cardPaymentMethod: 'apple' }))).toBe(
            'Apple Pay · Mastercard ПриватБанк'
        );
    });

    it('ховає номер для Google Pay', () => {
        expect(formatCardLabel(card({ cardPaymentMethod: 'google' }))).toBe(
            'Google Pay · Mastercard ПриватБанк'
        );
    });

    it('показує номер для оплати всередині застосунку monobank', () => {
        expect(formatCardLabel(card({ cardPaymentMethod: 'monobank' }))).toBe(
            'Mastercard ПриватБанк · 444403******1902'
        );
    });

    it('лишає давні записи без способу оплати такими, якими кабінет показував їх раніше', () => {
        expect(
            formatCardLabel({
                cardMask: '444403******1902',
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBe('444403******1902');
    });

    it('віддає null, коли про картку не відомо нічого', () => {
        expect(
            formatCardLabel({
                cardMask: null,
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBeNull();
    });

    it('не лишає порожнього підпису, коли від гаманця відомий лише номер пристрою', () => {
        expect(
            formatCardLabel({
                cardMask: '54456841******95',
                cardPaymentMethod: 'apple',
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBe('Apple Pay');
    });
});
