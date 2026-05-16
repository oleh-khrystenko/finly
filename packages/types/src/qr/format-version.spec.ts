import {
    PAYLOAD_VERSIONS,
    isPayloadVersion,
    type PayloadVersion,
} from './format-version';

describe('PAYLOAD_VERSIONS', () => {
    it('містить лише 002 і 003 (001 поза скоупом, пост-003 ще не існує)', () => {
        expect(PAYLOAD_VERSIONS).toEqual(['002', '003']);
    });

    it('readonly tuple — спроба мутувати видає TS-помилку', () => {
        const v: readonly string[] = PAYLOAD_VERSIONS;
        expect(v).toHaveLength(2);
    });
});

describe('isPayloadVersion', () => {
    it('приймає підтримувані версії', () => {
        expect(isPayloadVersion('002')).toBe(true);
        expect(isPayloadVersion('003')).toBe(true);
    });

    it('відхиляє legacy 001', () => {
        expect(isPayloadVersion('001')).toBe(false);
    });

    it('відхиляє ще-не-існуючу 004', () => {
        expect(isPayloadVersion('004')).toBe(false);
    });

    it('відхиляє нечислові рядки', () => {
        expect(isPayloadVersion('abc')).toBe(false);
        expect(isPayloadVersion('')).toBe(false);
    });

    it('звужує тип у TS', () => {
        const raw: string = '003';
        if (isPayloadVersion(raw)) {
            const narrowed: PayloadVersion = raw;
            expect(narrowed).toBe('003');
        }
    });
});
