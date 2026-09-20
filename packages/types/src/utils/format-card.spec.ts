import { describeCard } from './format-card';
import type { CardDetails } from '../contracts/payments';

const card = (over: Partial<CardDetails> = {}): CardDetails => ({
    cardMask: '444403******1902',
    cardPaymentMethod: 'pan',
    cardPaymentSystem: 'mastercard',
    cardBank: 'ПриватБанк',
    ...over,
});

describe('describeCard', () => {
    it('показує номер, коли платили введеною карткою', () => {
        expect(describeCard(card())).toBe(
            'Mastercard ПриватБанк · 444403******1902'
        );
    });

    it('показує номер для оплати всередині застосунку monobank', () => {
        expect(describeCard(card({ cardPaymentMethod: 'monobank' }))).toBe(
            'Mastercard ПриватБанк · 444403******1902'
        );
    });

    it('ховає номер для Apple Pay, лишаючи впізнавані систему і банк', () => {
        expect(describeCard(card({ cardPaymentMethod: 'apple' }))).toBe(
            'Apple Pay · Mastercard ПриватБанк'
        );
    });

    it('ховає номер для Google Pay', () => {
        expect(describeCard(card({ cardPaymentMethod: 'google' }))).toBe(
            'Google Pay · Mastercard ПриватБанк'
        );
    });

    it('ховає цифри, коли спосіб оплати невідомий: там може бути номер пристрою', () => {
        expect(
            describeCard(
                card({ cardPaymentMethod: null, cardMask: '52749303******24' })
            )
        ).toBe('Mastercard ПриватБанк');
    });

    it('ховає цифри для циклового списання токеном', () => {
        expect(describeCard(card({ cardPaymentMethod: 'wallet' }))).toBe(
            'Mastercard ПриватБанк'
        );
    });

    it('лишає назву гаманця, коли від нього відомий лише номер пристрою', () => {
        expect(
            describeCard({
                cardMask: '54456841******95',
                cardPaymentMethod: 'apple',
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBe('Apple Pay');
    });

    it('віддає null, коли показувати нічого, крім схованих цифр', () => {
        expect(
            describeCard({
                cardMask: '444403******1902',
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBeNull();
    });

    it('віддає null, коли про картку не відомо нічого', () => {
        expect(
            describeCard({
                cardMask: null,
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
            })
        ).toBeNull();
    });
});
