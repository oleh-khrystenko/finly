import { skipThrottlersExcept, THROTTLERS } from './throttle-policy';

describe('skipThrottlersExcept', () => {
    it('скіпає КОЖЕН бакет, окрім переданого', () => {
        const skip = skipThrottlersExcept('public-payment');
        // Ключ на кожен бакет — саме цього бракувало `{ default: true }`: guard
        // проганяє всі named-бакети, тож неперелічений `qr-preview` (10/хв)
        // тіньовив оголошені 600 до ефективних 10.
        expect(Object.keys(skip).sort()).toEqual(
            THROTTLERS.map((t) => t.name).sort()
        );
        expect(skip['public-payment']).toBe(false);
        expect(skip['qr-preview']).toBe(true);
        expect(skip.default).toBe(true);
    });

    it('приймає кілька збережених бакетів', () => {
        const skip = skipThrottlersExcept('public-payment', 'personalized-qr');
        expect(skip['public-payment']).toBe(false);
        expect(skip['personalized-qr']).toBe(false);
        expect(skip['help-chat']).toBe(true);
    });

    it('імена бакетів унікальні', () => {
        const names = THROTTLERS.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
