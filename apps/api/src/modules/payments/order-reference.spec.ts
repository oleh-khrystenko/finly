import {
    ORDER_KIND,
    buildOneOffOrderReference,
    buildRenewalOrderReference,
    buildSubscriptionOrderReference,
    parseOrderReference,
} from './order-reference';

const USER_ID = '507f1f77bcf86cd799439011';

describe('order-reference', () => {
    it('subscription checkout round-trips', () => {
        const ref = buildSubscriptionOrderReference(USER_ID);
        const parsed = parseOrderReference(ref);
        expect(parsed).toEqual({
            kind: ORDER_KIND.SUBSCRIPTION,
            userId: USER_ID,
        });
    });

    it('one-off round-trips з кодом', () => {
        const ref = buildOneOffOrderReference(USER_ID, 'brand');
        const parsed = parseOrderReference(ref);
        expect(parsed).toEqual({
            kind: ORDER_KIND.ONE_OFF,
            userId: USER_ID,
            oneOffCode: 'brand',
        });
    });

    it('renewal — ДЕТЕРМІНОВАНИЙ: однакова межа → однаковий reference (claim-first)', () => {
        const boundary = new Date('2026-07-01T12:00:00.000Z');
        const a = buildRenewalOrderReference(USER_ID, boundary);
        const b = buildRenewalOrderReference(USER_ID, new Date(boundary));
        expect(a).toBe(b);
        expect(parseOrderReference(a)).toEqual({
            kind: ORDER_KIND.SUBSCRIPTION,
            userId: USER_ID,
        });
    });

    it('різні межі → різні reference', () => {
        const a = buildRenewalOrderReference(
            USER_ID,
            new Date('2026-07-01T12:00:00.000Z')
        );
        const b = buildRenewalOrderReference(
            USER_ID,
            new Date('2026-08-01T12:00:00.000Z')
        );
        expect(a).not.toBe(b);
    });

    it('checkout-и унікальні (nonce)', () => {
        expect(buildSubscriptionOrderReference(USER_ID)).not.toBe(
            buildSubscriptionOrderReference(USER_ID)
        );
    });

    it('невідомий префікс / kind / oneOffCode → null', () => {
        expect(parseOrderReference('xxx-sub-abc-1')).toBeNull();
        expect(parseOrderReference('fin-bogus-abc-1')).toBeNull();
        expect(
            parseOrderReference(`fin-oneoff-unknown-${USER_ID}-deadbeef`)
        ).toBeNull();
        expect(parseOrderReference('fin-sub-too-many-parts-x')).toBeNull();
    });
});
