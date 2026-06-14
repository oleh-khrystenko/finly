import {
    ORDER_KIND,
    buildOneOffOrderReference,
    buildSubscriptionOrderReference,
    parseOrderReference,
} from './order-reference';

const USER_ID = '507f1f77bcf86cd799439011';

describe('order-reference', () => {
    it('subscription round-trip', () => {
        const ref = buildSubscriptionOrderReference(USER_ID);
        const parsed = parseOrderReference(ref);
        expect(parsed).toEqual({
            kind: ORDER_KIND.SUBSCRIPTION,
            userId: USER_ID,
        });
    });

    it('one-off round-trip зберігає oneOffCode', () => {
        const ref = buildOneOffOrderReference(USER_ID, 'bookkeeper');
        const parsed = parseOrderReference(ref);
        expect(parsed).toEqual({
            kind: ORDER_KIND.ONE_OFF,
            userId: USER_ID,
            oneOffCode: 'bookkeeper',
        });
    });

    it('генерує унікальні ref-и (nonce) для того самого користувача', () => {
        const a = buildSubscriptionOrderReference(USER_ID);
        const b = buildSubscriptionOrderReference(USER_ID);
        expect(a).not.toBe(b);
    });

    it('ref починається з префікса fin', () => {
        expect(buildSubscriptionOrderReference(USER_ID)).toMatch(/^fin-sub-/);
        expect(buildOneOffOrderReference(USER_ID, 'brand')).toMatch(
            /^fin-oneoff-brand-/
        );
    });

    it('повертає null на чужих/невалідних ref-ах', () => {
        expect(parseOrderReference('fin-prorate-x-1')).toBeNull();
        expect(parseOrderReference('random-string')).toBeNull();
        expect(parseOrderReference('fin-oneoff-unknown-uid-nonce')).toBeNull();
        expect(parseOrderReference('fin-sub-uid')).toBeNull(); // замало сегментів
        expect(parseOrderReference('')).toBeNull();
    });
});
