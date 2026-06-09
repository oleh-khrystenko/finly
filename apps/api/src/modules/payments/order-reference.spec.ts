import {
    ORDER_KIND,
    buildPackOrderReference,
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

    it('pack round-trip зберігає packCode', () => {
        const ref = buildPackOrderReference(USER_ID, 'max');
        const parsed = parseOrderReference(ref);
        expect(parsed).toEqual({
            kind: ORDER_KIND.PACK,
            userId: USER_ID,
            packCode: 'max',
        });
    });

    it('генерує унікальні ref-и (nonce) для того самого користувача', () => {
        const a = buildSubscriptionOrderReference(USER_ID);
        const b = buildSubscriptionOrderReference(USER_ID);
        expect(a).not.toBe(b);
    });

    it('ref починається з префікса fin', () => {
        expect(buildSubscriptionOrderReference(USER_ID)).toMatch(/^fin-sub-/);
        expect(buildPackOrderReference(USER_ID, 'basic')).toMatch(
            /^fin-pack-basic-/
        );
    });

    it('повертає null на чужих/невалідних ref-ах', () => {
        expect(parseOrderReference('fin-prorate-x-1')).toBeNull();
        expect(parseOrderReference('random-string')).toBeNull();
        expect(parseOrderReference('fin-pack-unknown-uid-nonce')).toBeNull();
        expect(parseOrderReference('fin-sub-uid')).toBeNull(); // замало сегментів
        expect(parseOrderReference('')).toBeNull();
    });
});
