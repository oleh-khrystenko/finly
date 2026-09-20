import type { CardDetails } from '@finly/types';
import { formatCardLabel } from './formatCard';

type CardLabelInput = CardDetails & { hasSavedCard: boolean };

const card = (over: Partial<CardLabelInput> = {}): CardLabelInput => ({
    cardMask: '444403******1902',
    cardPaymentMethod: 'pan',
    cardPaymentSystem: 'mastercard',
    cardBank: 'ПриватБанк',
    hasSavedCard: true,
    ...over,
});

const nothingToShow: CardDetails = {
    cardMask: null,
    cardPaymentMethod: null,
    cardPaymentSystem: null,
    cardBank: null,
};

describe('formatCardLabel', () => {
    it('віддає спільний опис картки, коли є що описувати', () => {
        expect(formatCardLabel(card())).toBe(
            'Mastercard ПриватБанк · 444403******1902'
        );
        expect(formatCardLabel(card({ cardPaymentMethod: 'apple' }))).toBe(
            'Apple Pay · Mastercard ПриватБанк'
        );
    });

    it('каже, що картка є, коли показувати нічого, крім схованих цифр', () => {
        expect(
            formatCardLabel(
                card({
                    cardPaymentMethod: null,
                    cardPaymentSystem: null,
                    cardBank: null,
                })
            )
        ).toBe("Картка прив'язана");
    });

    it('каже, що картка є, навіть коли банк не прислав жодного поля показу', () => {
        expect(formatCardLabel({ ...nothingToShow, hasSavedCard: true })).toBe(
            "Картка прив'язана"
        );
    });

    it('мовчить про збережену картку, коли її немає, а маска лишилась від старої', () => {
        expect(
            formatCardLabel(
                card({
                    cardPaymentMethod: null,
                    cardPaymentSystem: null,
                    cardBank: null,
                    hasSavedCard: false,
                })
            )
        ).toBeNull();
    });

    it('віддає null, коли про картку не відомо нічого', () => {
        expect(
            formatCardLabel({ ...nothingToShow, hasSavedCard: false })
        ).toBeNull();
    });
});
