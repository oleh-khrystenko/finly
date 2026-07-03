import {
    CLIENT_BUSINESS_LIMIT,
    evaluateClientBusinessCreation,
    evaluateOwnedBusinessCreation,
} from './business-limits';

describe('evaluateOwnedBusinessCreation', () => {
    it('фізособа / ФОП — максимум 1 незалежно від рівня (type-limit)', () => {
        for (const type of ['individual', 'fop'] as const) {
            expect(evaluateOwnedBusinessCreation(type, 0, 'none')).toEqual({
                allowed: true,
            });
            expect(evaluateOwnedBusinessCreation(type, 1, 'bookkeeper')).toEqual(
                { allowed: false, reason: 'type-limit' }
            );
        }
    });

    it('ТОВ / організація — 1 на none/brand (requires-plan)', () => {
        for (const type of ['tov', 'organization'] as const) {
            expect(evaluateOwnedBusinessCreation(type, 0, 'none')).toEqual({
                allowed: true,
            });
            expect(evaluateOwnedBusinessCreation(type, 1, 'none')).toEqual({
                allowed: false,
                reason: 'requires-plan',
            });
            expect(evaluateOwnedBusinessCreation(type, 1, 'brand')).toEqual({
                allowed: false,
                reason: 'requires-plan',
            });
        }
    });

    it('ТОВ / організація — без ліміту на bookkeeper', () => {
        expect(evaluateOwnedBusinessCreation('tov', 5, 'bookkeeper')).toEqual({
            allowed: true,
        });
        expect(
            evaluateOwnedBusinessCreation('organization', 5, 'bookkeeper')
        ).toEqual({ allowed: true });
    });
});

describe('evaluateClientBusinessCreation', () => {
    it('до ліміту — дозволено на будь-якому рівні', () => {
        expect(
            evaluateClientBusinessCreation(CLIENT_BUSINESS_LIMIT - 1, 'none')
        ).toEqual({ allowed: true });
    });

    it('на ліміті — requires-plan для none/brand', () => {
        expect(
            evaluateClientBusinessCreation(CLIENT_BUSINESS_LIMIT, 'none')
        ).toEqual({ allowed: false, reason: 'requires-plan' });
        expect(
            evaluateClientBusinessCreation(CLIENT_BUSINESS_LIMIT, 'brand')
        ).toEqual({ allowed: false, reason: 'requires-plan' });
    });

    it('bookkeeper — без ліміту', () => {
        expect(
            evaluateClientBusinessCreation(CLIENT_BUSINESS_LIMIT + 5, 'bookkeeper')
        ).toEqual({ allowed: true });
    });
});
