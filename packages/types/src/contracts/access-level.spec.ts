import {
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
                oneOffLevel: 'bookkeeper',
                oneOffAccessUntil: FUTURE,
            },
            NOW
        );
        expect(level).toBe('bookkeeper');
    });
});
