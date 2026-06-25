import {
    SUBSCRIPTION_STATUS,
    deriveAccessLevel,
    isAccessLevelAtLeast,
    maxAccessLevel,
    levelOfSubscriptionPlan,
    levelOfOneOffAccess,
} from './payments';

const NOW = new Date('2026-06-09T12:00:00.000Z');
const FUTURE = new Date('2026-07-09T12:00:00.000Z');
const PAST = new Date('2026-05-09T12:00:00.000Z');

describe('access-level primitives', () => {
    it('isAccessLevelAtLeast — впорядкованість none < brand < bookkeeper', () => {
        expect(isAccessLevelAtLeast('bookkeeper', 'brand')).toBe(true);
        expect(isAccessLevelAtLeast('brand', 'brand')).toBe(true);
        expect(isAccessLevelAtLeast('none', 'brand')).toBe(false);
        expect(isAccessLevelAtLeast('brand', 'bookkeeper')).toBe(false);
    });

    it('maxAccessLevel повертає вищий рівень', () => {
        expect(maxAccessLevel('none', 'brand')).toBe('brand');
        expect(maxAccessLevel('bookkeeper', 'brand')).toBe('bookkeeper');
        expect(maxAccessLevel('none', 'none')).toBe('none');
    });

    it('levelOf* мапить коди на рівні, none для невідомого', () => {
        expect(levelOfSubscriptionPlan('brand')).toBe('brand');
        expect(levelOfSubscriptionPlan('bookkeeper')).toBe('bookkeeper');
        expect(levelOfSubscriptionPlan(null)).toBe('none');
        expect(levelOfSubscriptionPlan('legacy-pro')).toBe('none');
        expect(levelOfOneOffAccess('bookkeeper')).toBe('bookkeeper');
        expect(levelOfOneOffAccess(undefined)).toBe('none');
    });
});

describe('deriveAccessLevel', () => {
    it('null білінг → none', () => {
        expect(deriveAccessLevel(null, NOW)).toBe('none');
    });

    it('активна підписка дає рівень плану', () => {
        const level = deriveAccessLevel(
            {
                planCode: 'bookkeeper',
                hasActiveSubscription: true,
                subscriptionStatus: null,
                oneOffLevel: null,
                oneOffAccessUntil: null,
            },
            NOW
        );
        expect(level).toBe('bookkeeper');
    });

    it('неактивна підписка не зараховується', () => {
        const level = deriveAccessLevel(
            {
                planCode: 'bookkeeper',
                hasActiveSubscription: false,
                subscriptionStatus: null,
                oneOffLevel: null,
                oneOffAccessUntil: null,
            },
            NOW
        );
        expect(level).toBe('none');
    });

    it('активний one-off дає рівень, поки дата у майбутньому', () => {
        const level = deriveAccessLevel(
            {
                planCode: null,
                hasActiveSubscription: false,
                subscriptionStatus: null,
                oneOffLevel: 'brand',
                oneOffAccessUntil: FUTURE,
            },
            NOW
        );
        expect(level).toBe('brand');
    });

    it('сплилий one-off гасне (дата у минулому)', () => {
        const level = deriveAccessLevel(
            {
                planCode: null,
                hasActiveSubscription: false,
                subscriptionStatus: null,
                oneOffLevel: 'bookkeeper',
                oneOffAccessUntil: PAST,
            },
            NOW
        );
        expect(level).toBe('none');
    });

    it('рівень = максимум підписки і one-off', () => {
        const level = deriveAccessLevel(
            {
                planCode: 'brand',
                hasActiveSubscription: true,
                subscriptionStatus: null,
                oneOffLevel: 'bookkeeper',
                oneOffAccessUntil: FUTURE,
            },
            NOW
        );
        expect(level).toBe('bookkeeper');
    });

    it('PAST_DUE підписка (грейс dunning) зараховується — доступ тримається', () => {
        // Прострочка в межах грейсу лишається живою: hasActiveSubscription=true,
        // доступ не гасне, поки billing-clock не вичерпав спроби.
        const level = deriveAccessLevel(
            {
                planCode: 'bookkeeper',
                hasActiveSubscription: true,
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                oneOffLevel: null,
                oneOffAccessUntil: null,
            },
            NOW
        );
        expect(level).toBe('bookkeeper');
    });

    it('ACTIVE підписка (після списання) зараховується повністю', () => {
        const level = deriveAccessLevel(
            {
                planCode: 'bookkeeper',
                hasActiveSubscription: true,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                oneOffLevel: 'brand',
                oneOffAccessUntil: FUTURE,
            },
            NOW
        );
        expect(level).toBe('bookkeeper');
    });
});
